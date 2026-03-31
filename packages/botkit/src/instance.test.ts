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
import { MemoryKvStore } from "@fedify/fedify/federation";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BotDispatcher, createInstance } from "./instance.ts";

test("createInstance(): static createBot always takes priority over dynamic createBot", async () => {
  const kv = new MemoryKvStore();
  const instance = createInstance<void>({ kv });

  // Register dynamic dispatchers first
  const dynamicDispatcher: BotDispatcher<void> = async (_ctx, identifier) => {
    if (identifier === "mybot") {
      return { username: "dynamic-bot" };
    }
    return null;
  };
  instance.createBot(dynamicDispatcher);

  // Register a static bot with the same identifier
  instance.createBot("mybot", { username: "static-bot" });

  // Request the actor - static bot should take priority
  const response = await instance.fetch(
    new Request("https://example.com/ap/actor/mybot", {
      headers: { Accept: "application/activity+json" },
    }),
    undefined,
  );
  assert.strictEqual(response.status, 200);
  const actor = await response.json();
  assert.strictEqual(actor.preferredUsername, "static-bot");
});

test("createInstance(): duplicate static identifier throws error", () => {
  const kv = new MemoryKvStore();
  const instance = createInstance<void>({ kv });

  instance.createBot("mybot", { username: "bot1" });

  assert.throws(() => {
    instance.createBot("mybot", { username: "bot2" });
  });
});

test("createInstance(): dynamic dispatchers are prioritized by creation order", async () => {
  const kv = new MemoryKvStore();
  const instance = createInstance<void>({ kv });

  let secondDispatcherCalled = false;

  const dispatcher1: BotDispatcher<void> = async (_ctx, identifier) => {
    if (identifier === "mybot") {
      return { username: "first-bot" };
    }
    return null;
  };

  const dispatcher2: BotDispatcher<void> = async (_ctx, identifier) => {
    secondDispatcherCalled = true;
    if (identifier === "mybot") {
      return { username: "second-bot" };
    }
    return null;
  };

  instance.createBot(dispatcher1);
  instance.createBot(dispatcher2);

  const response = await instance.fetch(
    new Request("https://example.com/ap/actor/mybot", {
      headers: { Accept: "application/activity+json" },
    }),
    undefined,
  );
  assert.strictEqual(response.status, 200);
  const actor = await response.json();
  assert.strictEqual(actor.preferredUsername, "first-bot");
  assert.ok(!secondDispatcherCalled);
});

test("createInstance(): dynamic dispatcher returns null falls through to next dispatcher", async () => {
  const kv = new MemoryKvStore();
  const instance = createInstance<void>({ kv });

  // First dispatcher always returns null
  const dispatcher1: BotDispatcher<void> = async (_ctx, _identifier) => {
    return null;
  };

  // Second dispatcher handles "mybot"
  const dispatcher2: BotDispatcher<void> = async (_ctx, identifier) => {
    if (identifier === "mybot") {
      return { username: "second-bot" };
    }
    return null;
  };

  instance.createBot(dispatcher1);
  instance.createBot(dispatcher2);

  const response = await instance.fetch(
    new Request("https://example.com/ap/actor/mybot", {
      headers: { Accept: "application/activity+json" },
    }),
    undefined,
  );
  assert.strictEqual(response.status, 200);
  const actor = await response.json();
  assert.strictEqual(actor.preferredUsername, "second-bot");
});
