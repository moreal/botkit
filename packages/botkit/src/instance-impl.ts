// BotKit by Fedify: A framework for creating ActivityPub bots
// Copyright (C) 2025 Hong Minhee <https://hongminhee.org/>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
import {
  type Context,
  createFederation,
  type Federation,
  generateCryptoKeyPair,
  type InboxContext,
  type NodeInfo,
  type RequestContext,
  type UnverifiedActivityReason,
} from "@fedify/fedify";
import {
  Accept,
  type Activity,
  type Actor,
  Announce,
  Article,
  ChatMessage,
  Create,
  Delete,
  Emoji as APEmoji,
  Endpoints,
  Follow,
  Image,
  Like as RawLike,
  Note,
  Question,
  Reject,
  Service,
  Undo,
} from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import { getXForwardedRequest } from "x-forwarded-fetch";
import metadata from "../deno.json" with { type: "json" };
import type { Bot } from "./bot.ts";
import { BotImpl, BotImplOptions } from "./bot-impl.ts";
import type { CustomEmoji, DeferredCustomEmoji } from "./emoji.ts";
import type {
  BotDispatcher,
  BotProfile,
  CreateInstanceOptions,
  Instance,
} from "./instance.ts";
import { KvRepository, type Repository } from "./repository.ts";
import type { Session } from "./session.ts";
import mimeDb from "mime-db";
import { SessionImpl } from "./session-impl.ts";

const DEFAULT_COLLECTION_WINDOW = 50;

interface DynamicBotEntry<TContextData> {
  readonly dispatcher: BotDispatcher<TContextData>;
  readonly template: BotImpl<TContextData>;
}

export class InstanceImpl<TContextData> implements Instance<TContextData> {
  readonly federation: Federation<TContextData>;
  readonly #options: CreateInstanceOptions;
  readonly #staticBots: Map<string, BotImpl<TContextData>>;
  readonly #dynamicEntries: DynamicBotEntry<TContextData>[];
  readonly customEmojis: Record<string, CustomEmoji>;

  readonly repository: Repository;
  readonly collectionWindow: number;

  constructor(options: CreateInstanceOptions) {
    this.#options = options;
    this.#staticBots = new Map();
    this.#dynamicEntries = [];
    this.federation = createFederation<TContextData>({
      kv: options.kv,
      queue: options.queue,
      userAgent: {
        software: `BotKit/${metadata.version}`,
      },
    });
    this.customEmojis = {};
    this.repository = options.repository ?? new KvRepository(options.kv);
    this.collectionWindow = options.collectionWindow ??
      DEFAULT_COLLECTION_WINDOW;

    this.#initialize();
  }

  #initialize(): void {
    this.federation
      .setActorDispatcher(
        "/ap/actor/{identifier}",
        this.dispatchActor.bind(this),
      )
      .mapHandle(this.#mapHandle.bind(this))
      .setKeyPairsDispatcher(this.#dispatchKeyPairs.bind(this));
    this.federation
      .setFollowersDispatcher(
        "/ap/actor/{identifier}/followers",
        this.#dispatchFollowers.bind(this),
      )
      .setFirstCursor(this.#getFollowersFirstCursor.bind(this))
      .setCounter(this.#countFollowers.bind(this));
    this.federation
      .setOutboxDispatcher(
        "/ap/actor/{identifier}/outbox",
        this.#dispatchOutbox.bind(this),
      )
      .setFirstCursor(this.#getOutboxFirstCursor.bind(this))
      .setCounter(this.#countOutbox.bind(this));
    this.federation
      .setObjectDispatcher(
        Follow,
        "/ap/follow/{id}",
        this.#dispatchFollow.bind(this),
      )
      .authorize(this.#authorizeFollow.bind(this));
    this.federation.setObjectDispatcher(
      Create,
      "/ap/create/{id}",
      this.#dispatchCreate.bind(this),
    );
    this.federation.setObjectDispatcher(
      Article,
      "/ap/article/{id}",
      (ctx, values) => this.#dispatchMessage(Article, ctx, values.id),
    );
    this.federation.setObjectDispatcher(
      ChatMessage,
      "/ap/chat-message/{id}",
      (ctx, values) => this.#dispatchMessage(ChatMessage, ctx, values.id),
    );
    this.federation.setObjectDispatcher(
      Note,
      "/ap/note/{id}",
      (ctx, values) => this.#dispatchMessage(Note, ctx, values.id),
    );
    this.federation.setObjectDispatcher(
      Question,
      "/ap/question/{id}",
      (ctx, values) => this.#dispatchMessage(Question, ctx, values.id),
    );
    this.federation.setObjectDispatcher(
      Announce,
      "/ap/announce/{id}",
      this.#dispatchAnnounce.bind(this),
    );
    this.federation.setObjectDispatcher(
      APEmoji,
      "/ap/emoji/{name}",
      this.#dispatchEmoji.bind(this),
    );
    this.federation
      .setInboxListeners("/ap/actor/{identifier}/inbox", "/ap/inbox")
      .onUnverifiedActivity(this.#onUnverifiedActivity.bind(this))
      .on(Follow, async (ctx, follow) => {
        await this.#routeToBot(
          ctx,
          follow,
          (bot) => bot.onFollowed(ctx, follow),
        );
      })
      .on(Undo, async (ctx, undo) => {
        const object = await undo.getObject(ctx);
        if (object instanceof Follow) {
          await this.#routeToBot(
            ctx,
            undo,
            (bot) => bot.onUnfollowed(ctx, undo),
          );
        } else if (object instanceof RawLike) {
          await this.#routeToBot(
            ctx,
            undo,
            (bot) => bot.onUnliked(ctx, undo),
          );
        } else {
          const logger = getLogger(["botkit", "bot", "inbox"]);
          logger.warn(
            "The Undo object {undoId} is not about Follow or Like: {object}.",
            { undoId: undo.id?.href, object },
          );
        }
      })
      .on(Accept, async (ctx, accept) => {
        await this.#routeToBot(
          ctx,
          accept,
          (bot) => bot.onFollowAccepted(ctx, accept),
        );
      })
      .on(Reject, async (ctx, reject) => {
        await this.#routeToBot(
          ctx,
          reject,
          (bot) => bot.onFollowRejected(ctx, reject),
        );
      })
      .on(Create, async (ctx, create) => {
        await this.#routeToBot(
          ctx,
          create,
          (bot) => bot.onCreated(ctx, create),
        );
      })
      .on(Announce, async (ctx, announce) => {
        await this.#routeToBot(
          ctx,
          announce,
          (bot) => bot.onAnnounced(ctx, announce),
        );
      })
      .on(RawLike, async (ctx, like) => {
        await this.#routeToBot(ctx, like, (bot) => bot.onLiked(ctx, like));
      })
      .setSharedKeyDispatcher((_ctx) => {
        const first = this.#staticBots.values().next();
        if (first.done) return null;
        return { identifier: first.value.identifier };
      });
    if (this.#options.software != null) {
      const software = this.#options.software;
      this.federation.setNodeInfoDispatcher(
        "/nodeinfo/2.1",
        (_ctx): NodeInfo => ({
          software,
          protocols: ["activitypub"],
          services: {
            outbound: ["atom1.0"],
          },
          usage: {
            users: {
              total: this.#staticBots.size,
              activeMonth: this.#staticBots.size,
              activeHalfyear: this.#staticBots.size,
            },
            localPosts: 0,
            localComments: 0,
          },
        }),
      );
    }
  }

  async #resolveBot(
    ctx: Context<TContextData>,
    identifier: string,
  ): Promise<BotImpl<TContextData> | null> {
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) return staticBot;
    for (const entry of this.#dynamicEntries) {
      const profile = await entry.dispatcher(ctx, identifier);
      if (profile != null) {
        const template = entry.template;
        const repository = new KvRepository(
          this.kv,
          createScopedPrefixes(identifier),
        );
        const bot = new BotImpl<TContextData>({
          identifier,
          username: profile.username,
          name: profile.name,
          class: profile.class,
          summary: profile.summary,
          icon: profile.icon,
          image: profile.image,
          properties: profile.properties,
          followerPolicy: profile.followerPolicy,
          kv: this.#options.kv,
          repository,
          pages: this.#options.pages,
          collectionWindow: this.collectionWindow,
          federation: this.federation,
        });
        // Copy event handlers from template
        bot.onFollow = template.onFollow;
        bot.onUnfollow = template.onUnfollow;
        bot.onAcceptFollow = template.onAcceptFollow;
        bot.onRejectFollow = template.onRejectFollow;
        bot.onMention = template.onMention;
        bot.onReply = template.onReply;
        bot.onQuote = template.onQuote;
        bot.onMessage = template.onMessage;
        bot.onSharedMessage = template.onSharedMessage;
        bot.onLike = template.onLike;
        bot.onUnlike = template.onUnlike;
        bot.onReact = template.onReact;
        bot.onUnreact = template.onUnreact;
        bot.onVote = template.onVote;

        return bot;
      }
    }
    return null;
  }

  #resolveBotsFromAddressing(
    ctx: Context<TContextData>,
    activity: Activity,
  ): Set<string> {
    const identifiers = new Set<string>();
    const recipientIds = [
      ...activity.toIds,
      ...activity.ccIds,
      ...activity.btoIds,
      ...activity.bccIds,
    ];
    for (const uri of recipientIds) {
      const parsed = ctx.parseUri(uri);
      if (
        parsed != null &&
        "identifier" in parsed &&
        parsed.identifier != null &&
        parsed.type === "actor"
      ) {
        identifiers.add(parsed.identifier);
      }
    }
    return identifiers;
  }

  async #routeToBot(
    ctx: InboxContext<TContextData>,
    activity: Activity,
    callback: (bot: BotImpl<TContextData>) => Promise<void>,
  ): Promise<void> {
    if (ctx.recipient != null) {
      const bot = await this.#resolveBot(ctx, ctx.recipient);
      if (bot instanceof BotImpl) await callback(bot);
      return;
    }
    // Shared inbox: resolve target bots from addressing only
    const identifiers = this.#resolveBotsFromAddressing(ctx, activity);
    const routed = new Set<Bot<TContextData>>();
    for (const id of identifiers) {
      const bot = await this.#resolveBot(ctx, id);
      if (bot instanceof BotImpl && !routed.has(bot)) {
        routed.add(bot);
        await callback(bot);
      }
    }
  }

  #onUnverifiedActivity(
    _ctx: RequestContext<TContextData>,
    activity: Activity,
    reason: UnverifiedActivityReason,
  ): Response | void {
    if (
      activity instanceof Delete &&
      reason.type === "keyFetchError" &&
      "status" in reason.result &&
      reason.result.status === 410
    ) {
      return new Response(null, { status: 202 });
    }
  }

  // Actor dispatching

  async dispatchActor(
    ctx: Context<TContextData>,
    identifier: string,
  ): Promise<Actor | null> {
    // Static bots always take priority
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) {
      return staticBot.dispatchActor(ctx, identifier);
    }
    // Try dynamic dispatchers in creation order
    for (const entry of this.#dynamicEntries) {
      const profile = await entry.dispatcher(ctx, identifier);
      if (profile != null) {
        return await this.#buildActor(ctx, identifier, profile);
      }
    }
    return null;
  }

  async #buildActor(
    ctx: Context<TContextData>,
    identifier: string,
    profile: BotProfile<TContextData>,
  ): Promise<Actor> {
    const cls = profile.class ?? Service;
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    // TODO: Render summary and properties using a session.
    return new cls({
      id: ctx.getActorUri(identifier),
      preferredUsername: profile.username,
      name: profile.name,
      icon: profile.icon == null
        ? null
        : profile.icon instanceof Image
        ? profile.icon
        : new Image({ url: profile.icon }),
      image: profile.image == null
        ? null
        : profile.image instanceof Image
        ? profile.image
        : new Image({ url: profile.image }),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      followers: ctx.getFollowersUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((pair) => pair.multikey),
      url: new URL("/", ctx.origin),
    });
  }

  #mapHandle(_ctx: Context<TContextData>, username: string): string | null {
    for (const [, botImpl] of this.#staticBots) {
      if (botImpl.username === username) return botImpl.identifier;
    }
    return null;
  }

  async #dispatchKeyPairs(
    ctx: Context<TContextData>,
    identifier: string,
  ): Promise<CryptoKeyPair[]> {
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) {
      return staticBot.dispatchActorKeyPairs(ctx, identifier);
    }
    // For dynamic bots, generate ephemeral key pairs.
    // TODO: Use per-identifier persistent key storage.
    const rsa = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    const ed25519 = await generateCryptoKeyPair("Ed25519");
    return [rsa, ed25519];
  }

  // Followers / outbox delegation

  async #dispatchFollowers(
    ctx: Context<TContextData>,
    identifier: string,
    cursor: string | null,
  ) {
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) {
      return staticBot.dispatchFollowers(ctx, identifier, cursor);
    }
    return null;
  }

  async #getFollowersFirstCursor(
    ctx: Context<TContextData>,
    identifier: string,
  ): Promise<string | null> {
    const bot = await this.#resolveBot(ctx, identifier);
    if (bot != null) {
      return bot.getFollowersFirstCursor(ctx, identifier);
    }
    return null;
  }

  async #countFollowers(
    ctx: Context<TContextData>,
    identifier: string,
  ): Promise<number | null> {
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) {
      return await staticBot.countFollowers(ctx, identifier);
    }
    return null;
  }

  async #dispatchOutbox(
    ctx: RequestContext<TContextData>,
    identifier: string,
    cursor: string | null,
  ) {
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) {
      return staticBot.dispatchOutbox(ctx, identifier, cursor);
    }
    return null;
  }

  #getOutboxFirstCursor(
    ctx: Context<TContextData>,
    identifier: string,
  ): string | null {
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) {
      return staticBot.getOutboxFirstCursor(ctx, identifier);
    }
    return null;
  }

  async #countOutbox(
    ctx: Context<TContextData>,
    identifier: string,
  ): Promise<number | null> {
    const staticBot = this.#staticBots.get(identifier);
    if (staticBot != null) {
      return await staticBot.countOutbox(ctx, identifier);
    }
    return null;
  }

  // Object dispatchers (iterate all static bots)
  async #dispatchFollow(
    ctx: RequestContext<TContextData>,
    values: { id: string },
  ): Promise<Follow | null> {
    for (const bot of this.#staticBots.values()) {
      const result = await bot.dispatchFollow(ctx, values);
      if (result != null) return result;
    }
    return null;
  }

  async #authorizeFollow(
    ctx: RequestContext<TContextData>,
    values: { id: string },
  ): Promise<boolean> {
    for (const bot of this.#staticBots.values()) {
      if (await bot.authorizeFollow(ctx, values)) return true;
    }
    return false;
  }

  async #dispatchCreate(
    ctx: RequestContext<TContextData>,
    values: { id: string },
  ): Promise<Create | null> {
    for (const bot of this.#staticBots.values()) {
      const result = await bot.dispatchCreate(ctx, values);
      if (result != null) return result;
    }
    return null;
  }

  async #dispatchMessage<
    T extends InstanceType<
      typeof Article | typeof ChatMessage | typeof Note | typeof Question
    >,
  >(
    // deno-lint-ignore no-explicit-any
    cls: new (values: any) => T,
    ctx: Context<TContextData> | RequestContext<TContextData>,
    id: string,
  ): Promise<T | null> {
    for (const bot of this.#staticBots.values()) {
      const result = await bot.dispatchMessage(cls, ctx, id);
      if (result != null) return result;
    }
    return null;
  }

  async #dispatchAnnounce(
    ctx: RequestContext<TContextData>,
    values: { id: string },
  ): Promise<Announce | null> {
    for (const bot of this.#staticBots.values()) {
      const result = await bot.dispatchAnnounce(ctx, values);
      if (result != null) return result;
    }
    return null;
  }

  #dispatchEmoji(
    ctx: Context<TContextData>,
    values: { name: string },
  ): APEmoji | null {
    const customEmoji = this.customEmojis[values.name];
    if (customEmoji == null) return null;
    return this.getEmoji(ctx, values.name, customEmoji);
  }

  // createBot
  createBot(
    identifier: string,
    options: BotProfile<TContextData>,
  ): Bot<TContextData>;
  createBot(
    dispatcher: BotDispatcher<TContextData>,
  ): Bot<TContextData>;
  createBot(
    identifierOrDispatcher: string | BotDispatcher<TContextData>,
    options?: BotProfile<TContextData>,
  ): Bot<TContextData> {
    if (typeof identifierOrDispatcher === "string") {
      const identifier = identifierOrDispatcher;
      if (this.#staticBots.has(identifier)) {
        throw new TypeError(
          `A bot with identifier ${JSON.stringify(identifier)} already exists.`,
        );
      }
      const staticBot = new BotImpl<TContextData>({
        ...options!,
        identifier,
        federation: this.federation,
        kv: this.#options.kv,
        repository: this.#options.repository,
        pages: this.#options.pages,
        collectionWindow: this.collectionWindow,
      });
      this.#staticBots.set(identifier, staticBot);
      return staticBot;
    }

    const dispatcher = identifierOrDispatcher;
    const template = new BotImpl<TContextData>({
      identifier: "__template__",
      username: "__template__",
      federation: this.federation,
      kv: this.#options.kv,
      repository: this.#options.repository,
      pages: this.#options.pages,
      collectionWindow: this.collectionWindow,
    });
    this.#dynamicEntries.push({ dispatcher, template });
    return template;
  }

  // fetch

  async fetch(request: Request, contextData: TContextData): Promise<Response> {
    if (this.#options.behindProxy) {
      request = await getXForwardedRequest(request);
    }
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/.well-known/") ||
      url.pathname.startsWith("/ap/") ||
      url.pathname.startsWith("/nodeinfo/")
    ) {
      return await this.federation.fetch(request, { contextData });
    }
    return new Response("Not Found", { status: 404 });
  }

  getEmoji(
    ctx: Context<TContextData>,
    name: string,
    data: CustomEmoji,
  ): APEmoji {
    let url: URL;
    if ("url" in data) {
      url = new URL(data.url);
    } else {
      // @ts-ignore: data.type satisfies keyof typeof mimeDb
      const t = mimeDb[data.type];
      url = new URL(
        `/emojis/${name}${
          t == null || t.extensions == null || t.extensions.length < 1
            ? ""
            : `.${t.extensions[0]}`
        }`,
        ctx.origin,
      );
    }
    return new APEmoji({
      id: ctx.getObjectUri(APEmoji, { name }),
      name: `:${name}:`,
      icon: new Image({
        mediaType: data.type,
        url,
      }),
    });
  }

  addCustomEmoji<TEmojiName extends string>(
    name: TEmojiName,
    data: CustomEmoji,
  ): DeferredCustomEmoji<TContextData> {
    if (!name.match(/^[a-z0-9-_]+$/i)) {
      throw new TypeError(
        `Invalid custom emoji name: ${name}. It must match /^[a-z0-9-_]+$/i.`,
      );
    } else if (name in this.customEmojis) {
      throw new TypeError(`Duplicate custom emoji name: ${name}`);
    } else if (!data.type.startsWith("image/")) {
      throw new TypeError(`Unsupported media type: ${data.type}`);
    }
    this.customEmojis[name] = data;
    return (session: Session<TContextData>) =>
      this.getEmoji(
        session.context,
        name,
        data,
      );
  }

  addCustomEmojis<TEmojiName extends string>(
    emojis: Readonly<Record<TEmojiName, CustomEmoji>>,
  ): Readonly<Record<TEmojiName, DeferredCustomEmoji<TContextData>>> {
    const emojiMap = {} as Record<
      TEmojiName,
      DeferredCustomEmoji<TContextData>
    >;
    for (const name in emojis) {
      emojiMap[name] = this.addCustomEmoji(name, emojis[name]);
    }
    return emojiMap;
  }

  getSession(
    identifier: string,
    origin: string | URL,
    contextData: TContextData,
  ): Promise<SessionImpl<TContextData>>;
  getSession(
    identifier: string,
    origin: string | URL,
  ): Promise<SessionImpl<TContextData>>;
  getSession(
    identifier: string,
    context: Context<TContextData>,
  ): Promise<SessionImpl<TContextData>>;

  async getSession(
    identifier: string,
    origin: string | URL | Context<TContextData>,
    contextData?: TContextData,
  ): Promise<SessionImpl<TContextData>> {
    const ctx = typeof origin === "string" || origin instanceof URL
      ? this.federation.createContext(new URL(origin), contextData!)
      : origin;
    const bot = await this.#resolveBot(ctx, identifier);
    if (bot == null) {
      throw new Error("No such bot");
    }

    return new SessionImpl(this, bot, ctx);
  }
}
