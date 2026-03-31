import type { Application, Bot, Image, Service } from "@fedify/botkit/bot";
import type {
  Context,
  Federation,
  KvStore,
  MessageQueue,
  Software,
} from "@fedify/fedify";
import type { Text } from "@fedify/botkit/text";
import type { Repository } from "@fedify/botkit/repository";
import { InstanceImpl } from "./instance-impl.ts";
import type { Session } from "./session.ts";
import type { CustomEmoji, DeferredCustomEmoji } from "./emoji.ts";

export interface BotProfile<TContextData> {
  /**
   * The type of the bot actor.  It should be either `Service` or `Application`.
   *
   * If omitted, `Service` will be used.
   * @default `Service`
   */
  readonly class?: typeof Service | typeof Application;

  /**
   * The username of the bot.  It will be a part of the fediverse handle.
   * It can be changed after the bot is federated.
   */
  readonly username: string;

  /**
   * The display name of the bot.  It can be changed after the bot is federated.
   */
  readonly name?: string;

  /**
   * The description of the bot.  It can be changed after the bot is federated.
   */
  readonly summary?: Text<"block", TContextData>;

  /**
   * The avatar URL of the bot.  It can be changed after the bot is federated.
   */
  readonly icon?: URL | Image;

  /**
   * The header image URL of the bot.  It can be changed after the bot is
   * federated.
   */
  readonly image?: URL | Image;

  /**
   * The custom properties of the bot.  It can be changed after the bot is
   * federated.
   */
  readonly properties?: Record<string, Text<"block" | "inline", TContextData>>;

  /**
   * How to handle incoming follow requests.  Note that this behavior can be
   * overridden by manually invoking {@link FollowRequest.accept} or
   * {@link FollowRequest.reject} in the {@link Bot.onFollow} event handler.
   *
   * - `"accept"` (default): Automatically accept all incoming follow requests.
   * - `"reject"`: Automatically reject all incoming follow requests.
   * - `"manual"`: Require manual handling of incoming follow requests.
   * @default `"accept"`
   */
  readonly followerPolicy?: "accept" | "reject" | "manual";
}

/**
 * A dispatcher that dynamically resolves a bot profile for a given identifier.
 * Returns `null` if the dispatcher cannot handle the given identifier,
 * allowing the next dispatcher in the chain to be tried.
 */
export type BotDispatcher<TContextData> = (
  context: Context<TContextData>,
  identifier: string,
) => Promise<BotProfile<TContextData> | null>;

/**
 * Options for creating an instance.
 */
export interface CreateInstanceOptions {
  /**
   * The underlying key-value store to use for storing data.
   */
  readonly kv: KvStore;

  /**
   * The underlying repository to use for storing data.  If omitted,
   * {@link KvRepository} will be used.
   */
  readonly repository?: Repository;

  /**
   * The underlying message queue to use for handling incoming and outgoing
   * activities.  If omitted, incoming activities are processed immediately,
   * and outgoing activities are sent immediately.
   */
  readonly queue?: MessageQueue;

  /**
   * The software information of the bot.  If omitted, the NodeInfo protocol
   * will be unimplemented.
   */
  readonly software?: Software;

  /**
   * Whether to trust `X-Forwarded-*` headers.  If your bot application is
   * behind an L7 reverse proxy, turn it on.
   *
   * Turned off by default.
   * @default `false`
   */
  readonly behindProxy?: boolean;

  /**
   * The options for the web pages of the bot.  If omitted, the default options
   * will be used.
   */
  readonly pages?: PagesOptions;

  readonly collectionWindow?: number;
}

/**
 * Options for the web pages of the instance.
 */
export interface PagesOptions {
  /**
   * The color of the theme.  It will be used for the theme color of the web
   * pages.  The default color is `"green"`.
   * @default `"green"`
   */
  readonly color?:
    | "amber"
    | "azure"
    | "blue"
    | "cyan"
    | "fuchsia"
    | "green"
    | "grey"
    | "indigo"
    | "jade"
    | "lime"
    | "orange"
    | "pink"
    | "pumpkin"
    | "purple"
    | "red"
    | "sand"
    | "slate"
    | "violet"
    | "yellow"
    | "zinc";

  /**
   * The CSS code for the bot.  It will be used for the custom CSS of the web
   * pages.
   */
  readonly css?: string;
}

export interface Instance<TContextData> {
  /**
   * An internal Fedify federation instance.  Normally you don't need to access
   * this directly.
   */
  readonly federation: Federation<TContextData>;

  createBot(
    identifier: string,
    options: BotProfile<TContextData>,
  ): Bot<TContextData>;
  createBot(
    dispatcher: BotDispatcher<TContextData>,
  ): Bot<TContextData>;

  /**
   * The fetch API for handling HTTP requests.  You can pass this to an HTTP
   * server (e.g., `Deno.serve()`, `Bun.serve()`) to handle incoming requests.
   * @param request The request to handle.
   * @param contextData The context data to pass to the federation.
   * @returns The response to the request.
   */
  fetch(request: Request, contextData: TContextData): Promise<Response>;

  /**
   * Gets a new session to control the bot for a specific origin and context
   * data.
   * @param origin The origin of the session.  Even if a URL with some path or
   *               query is passed, only the origin part will be used.
   * @param contextData The context data to pass to the federation.
   * @returns The session for the origin and context data.
   */
  getSession(
    identifier: string,
    origin: string | URL,
    contextData: TContextData,
  ): Promise<Session<TContextData>>;

  /**
   * Gets a new session to control bot for a specific Fedify context.
   * @param context The Fedify context of the session.
   * @returns The session for the Fedify context.
   */
  getSession(
    identifier: string,
    context: Context<TContextData>,
  ): Promise<Session<TContextData>>;

  /**
   * Defines custom emojis for the bot.  The custom emojis are used for
   * rendering the bot's profile and posts.  The custom emojis are defined
   * by their names, and the names are used as the keys of the emojis.
   * @param emojis The custom emojis to define.  The keys are the names of
   *               the emojis, and the values are the custom emoji definitions.
   * @returns The defined emojis.  The keys are the names of the emojis, and
   *          the values are the emoji objects, which are used for passing
   *          to the {@link customEmoji} function.
   * @throws {TypeError} If any emoji name is invalid or duplicate.
   * @since 0.2.0
   */
  addCustomEmojis<TEmojiName extends string>(
    emojis: Readonly<Record<TEmojiName, CustomEmoji>>,
  ): Readonly<Record<TEmojiName, DeferredCustomEmoji<TContextData>>>;
}

export function createInstance<TContextData = void>(
  options: CreateInstanceOptions,
): Instance<TContextData> {
  return new InstanceImpl(options);
}
