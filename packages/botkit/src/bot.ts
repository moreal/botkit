// BotKit by Fedify: A framework for creating ActivityPub bots
// Copyright (C) 2025–2026 Hong Minhee <https://hongminhee.org/>
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
import type { Context } from "@fedify/fedify/federation";
import type { CustomEmoji, DeferredCustomEmoji } from "./emoji.ts";
import type {
  AcceptEventHandler,
  FollowEventHandler,
  LikeEventHandler,
  MentionEventHandler,
  MessageEventHandler,
  QuoteEventHandler,
  ReactionEventHandler,
  RejectEventHandler,
  ReplyEventHandler,
  SharedMessageEventHandler,
  UndoneReactionEventHandler,
  UnfollowEventHandler,
  UnlikeEventHandler,
  VoteEventHandler,
} from "./events.ts";
import type { Session } from "./session.ts";
import {
  type BotProfile,
  createInstance,
  type CreateInstanceOptions,
  type Instance,
} from "./instance.ts";
export { type Software } from "@fedify/fedify/nodeinfo";
export { Application, Image, Service } from "@fedify/vocab";

/**
 * A bot that can interact with the ActivityPub network.
 */
export interface Bot<TContextData> {
  /**
   * An event handler for a follow request to the bot.
   */
  onFollow?: FollowEventHandler<TContextData>;

  /**
   * An event handler for an unfollow event from the bot.
   */
  onUnfollow?: UnfollowEventHandler<TContextData>;

  /**
   * An event handler invoked when a follow request the bot sent is accepted.
   */
  onAcceptFollow?: AcceptEventHandler<TContextData>;

  /**
   * An event handler invoked when a follow request the bot sent is rejected.
   */
  onRejectFollow?: RejectEventHandler<TContextData>;

  /**
   * An event handler for a message mentioned to the bot.
   */
  onMention?: MentionEventHandler<TContextData>;

  /**
   * An event handler for a reply to the bot.
   */
  onReply?: ReplyEventHandler<TContextData>;

  /**
   * An event handler for a quote of the bot's message.
   * @since 0.2.0
   */
  onQuote?: QuoteEventHandler<TContextData>;

  /**
   * An event handler for a message shown to the bot's timeline.  To listen
   * to this event, your bot needs to follow others first.
   */
  onMessage?: MessageEventHandler<TContextData>;

  /**
   * An event handler for a message shared to the bot.  To listen to this event,
   * your bot needs to follow others first.
   */
  onSharedMessage?: SharedMessageEventHandler<TContextData>;

  /**
   * An event handler for a like of a message.
   */
  onLike?: LikeEventHandler<TContextData>;

  /**
   * An event handler for an undoing of a like of a message.
   */
  onUnlike?: UnlikeEventHandler<TContextData>;

  /**
   * An event handler for an emoji reaction to a message.
   * @since 0.2.0
   */
  onReact?: ReactionEventHandler<TContextData>;

  /**
   * An event handler for an undoing of an emoji reaction to a message.
   * @since 0.2.0
   */
  onUnreact?: UndoneReactionEventHandler<TContextData>;

  /**
   * An event handler for a vote in a poll.  This event is only triggered when
   * the bot is the author of the poll, and the vote is made by another actor.
   * If the poll allows multiple selections, this event is triggered multiple
   * times, once for each option selected by the actor.
   *
   * Note that this event can be triggered even if the voter vote an option
   * multiple times or multiple options for a poll that disallows multiple
   * selections.  You should validate the vote in the event handler by storing
   * the votes in a persistent store, and checking if the vote is valid.
   * (This behavior can subject to change in the future.)
   * @since 0.3.0
   */
  onVote?: VoteEventHandler<TContextData>;
}

export type BotWithVoidContextData = Bot<void>;

/**
 * Options for creating a bot.
 */
export type CreateBotOptions<TContextData> =
  & CreateInstanceOptions
  & BotProfile<TContextData>
  & {
    /**
     * The internal identifier of the bot.  Since it is used for the actor URI,
     * it *should not* be changed after the bot is federated.
     *
     * If omitted, `"bot"` will be used.
     * @default `"bot"`
     */
    readonly identifier?: string;
  };

/**
 * Fields existed in Bot before Instance was introduced.
 */
type LegacyBotFields<TContextData> = Pick<
  Instance<TContextData>,
  "federation" | "fetch"
>;

const FALLBACK_BOT_IDENTIFIER = "bot";

/**
 * Creates a {@link Bot} instance.
 * @param options The options for creating the bot.
 * @returns The created bot instance.
 */
export function createBot<TContextData = void>(
  options: CreateBotOptions<TContextData>,
): Bot<TContextData> & LegacyBotFields<TContextData> {
  const instance = createInstance<TContextData>(options);
  const bot = instance.createBot(
    options.identifier || FALLBACK_BOT_IDENTIFIER,
    options,
  );
  // Since `deno serve` does not recognize a class instance having fetch(),
  // we wrap an Instance instance with a plain object.
  // See also https://github.com/denoland/deno/issues/24062
  const wrapper = {
    instance: instance,
    bot: bot,
    get federation() {
      return instance.federation;
    },
    get identifier() {
      return bot.identifier;
    },
    getSession(a, b?) {
      // @ts-ignore: BotImpl.getSession() implements Bot.getSession()
      return bot.getSession(a, b);
    },
    fetch(request, contextData) {
      return instance.fetch(request, contextData);
    },
    addCustomEmojis<TEmojiName extends string>(
      emojis: Readonly<Record<TEmojiName, CustomEmoji>>,
    ): Readonly<Record<TEmojiName, DeferredCustomEmoji<TContextData>>> {
      return bot.addCustomEmojis(emojis);
    },
    get onFollow() {
      return bot.onFollow;
    },
    set onFollow(value) {
      bot.onFollow = value;
    },
    get onUnfollow() {
      return bot.onUnfollow;
    },
    set onUnfollow(value) {
      bot.onUnfollow = value;
    },
    get onAcceptFollow() {
      return bot.onAcceptFollow;
    },
    set onAcceptFollow(value) {
      bot.onAcceptFollow = value;
    },
    get onRejectFollow() {
      return bot.onRejectFollow;
    },
    set onRejectFollow(value) {
      bot.onRejectFollow = value;
    },
    get onMention() {
      return bot.onMention;
    },
    set onMention(value) {
      bot.onMention = value;
    },
    get onReply() {
      return bot.onReply;
    },
    set onReply(value) {
      bot.onReply = value;
    },
    get onQuote() {
      return bot.onQuote;
    },
    set onQuote(value) {
      bot.onQuote = value;
    },
    get onMessage() {
      return bot.onMessage;
    },
    set onMessage(value) {
      bot.onMessage = value;
    },
    get onSharedMessage() {
      return bot.onSharedMessage;
    },
    set onSharedMessage(value) {
      bot.onSharedMessage = value;
    },
    get onLike() {
      return bot.onLike;
    },
    set onLike(value) {
      bot.onLike = value;
    },
    get onUnlike() {
      return bot.onUnlike;
    },
    set onUnlike(value) {
      bot.onUnlike = value;
    },
    get onReact() {
      return bot.onReact;
    },
    set onReact(value) {
      bot.onReact = value;
    },
    get onUnreact() {
      return bot.onUnreact;
    },
    set onUnreact(value) {
      bot.onUnreact = value;
    },
    get onVote() {
      return bot.onVote;
    },
    set onVote(value) {
      bot.onVote = value;
    },
  } satisfies Bot<TContextData> & LegacyBotFields<TContextData> & {
    instance: Instance<TContextData>;
    bot: Bot<TContextData>;
  };
  return wrapper;
}
