require("dotenv").config();
import { createHttpLink } from "apollo-link-http";
import { InMemoryCache } from "apollo-cache-inmemory";
import ApolloClient from "apollo-client";
import fetch from "node-fetch";
import Telegraf from "telegraf";
import { format } from "date-fns";
import * as fs from "fs";

import { AdvertList } from "../generated/queries";
import { AdvertListQuery, AdvertListQueryVariables } from "../generated/types";

const BOT_TOKEN = process.env.BOT_TOKEN;

const PREMIUM_INTERVAL = parseInt(process.env.PREMIUM_INTERVAL);
const REGULAR_INTERVAL =
  PREMIUM_INTERVAL * parseInt(process.env.REGULAR_INTERVAL_MULTIPLIER);

const BACKUP_PATH = process.env.BACKUP_PATH;
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL);

const SUBSCRIBERS_BACKUP = !BACKUP_PATH
  ? null
  : `${BACKUP_PATH}/subscribers.json`;

const API = "https://www.bezrealitky.cz/webgraphql";

let lastUpdate = null;

const client = new ApolloClient({
  link: createHttpLink({ uri: API, fetch }),
  cache: new InMemoryCache()
});

interface ISubscriber {
  variables: AdvertListQueryVariables | null;
  cursor: number | null;
  isPremium: boolean;
}

let subscribers = new Map<number, ISubscriber>();

const fetchAdvert = async (variables: AdvertListQueryVariables) => {
  try {
    const { data } = await client.query<
      AdvertListQuery,
      AdvertListQueryVariables
    >({
      query: AdvertList,
      variables,
      fetchPolicy: "no-cache"
    });

    return (data && data.advertList && data.advertList.list) || [];
  } catch (error) {
    console.warn(error);
    return [];
  }
};

const sleep = (duration: number) =>
  new Promise(resolve => setTimeout(resolve, duration));

const nextUpdateTime = (isPremium: boolean) => {
  const now = Date.now();
  const timestamp =
    now +
    (isPremium
      ? PREMIUM_INTERVAL - (now % PREMIUM_INTERVAL)
      : REGULAR_INTERVAL - (now % REGULAR_INTERVAL));
  return format(timestamp, "HH:mm");
};

const formatSubscribersLog = (
  subscribersArray: Array<[number, ISubscriber]>
) => {
  return subscribersArray
    .map(
      ([key, subscriber]) =>
        `\`\`\`\n` +
        `${key}\n` +
        Object.entries(subscriber)
          .map(([key, value]) => `\t${key}: ${JSON.stringify(value)}`)
          .join("\n") +
        `\`\`\``
    )
    .join("\n\n");
};

(async () => {
  while (true) {
    const now = Date.now();
    const timestamp = now - (now % PREMIUM_INTERVAL);

    lastUpdate = timestamp;

    await Promise.all(
      Array.from(subscribers.keys()).map(async key => {
        const subscriber = subscribers.get(key);

        if (
          subscriber.variables == null ||
          (!subscriber.isPremium && timestamp % REGULAR_INTERVAL !== 0)
        ) {
          return;
        }

        const results = await fetchAdvert(subscriber.variables);
        const recentAdvertId = results.length > 0 ? results[0].id : null;

        if (recentAdvertId == null) {
          return;
        }

        if (subscriber.cursor == null) {
          subscriber.cursor = recentAdvertId;
          return;
        }

        let cursorIndex = results.findIndex(r => r.id === subscriber.cursor);
        if (cursorIndex === -1) {
          cursorIndex = results.length;
        }

        results
          .slice(0, cursorIndex)
          .forEach(r =>
            bot.telegram.sendMessage(
              key,
              `[${r.absoluteUrl}](${r.shortDescription})`,
              { parse_mode: "Markdown" }
            )
          );

        subscriber.cursor = recentAdvertId;
      })
    );

    await sleep(PREMIUM_INTERVAL);
  }
})();

(() => {
  if (!SUBSCRIBERS_BACKUP) {
    console.warn(`Backup is disabled`);

    return;
  }

  try {
    const subscribersPersist = require(SUBSCRIBERS_BACKUP);
    subscribers = new Map(subscribersPersist);
  } catch (e) {
    console.warn(e);
  }

  setInterval(() => {
    fs.writeFile(
      SUBSCRIBERS_BACKUP,
      JSON.stringify(Array.from(subscribers.entries())),
      err => {
        if (err) {
          console.warn(err);
          return;
        }

        console.log("Backup Complete:", new Date().toUTCString());
      }
    );
  }, BACKUP_INTERVAL);
})();

const getSubscriber = (chatId: number) => {
  if (subscribers.has(chatId)) {
    return subscribers.get(chatId);
  }

  subscribers.set(chatId, {
    variables: null,
    cursor: null,
    isPremium: false
  });
  return subscribers.get(chatId);
};

const bot = new Telegraf(BOT_TOKEN);
bot.start(ctx => {
  ctx.reply("Welcome!");
});
bot.on("location", ctx => {
  const subscriber = getSubscriber(ctx.chat.id);
  subscriber.variables = {
    location: {
      lat: ctx.update.message.location.latitude,
      lng: ctx.update.message.location.longitude
    }
  };
  subscriber.cursor = null;

  ctx.reply("You have been subscribed");
});
bot.command("subscription", async ctx => {
  const subscriber = getSubscriber(ctx.chat.id);
  if (subscriber.variables == null) {
    ctx.reply("You have no subscription");
    return;
  }

  await ctx.telegram.sendLocation(
    ctx.chat.id,
    subscriber.variables.location.lat,
    subscriber.variables.location.lng
  );
  await ctx.telegram.sendMessage(
    ctx.chat.id,
    `NEXT UPDATE TIME: *${nextUpdateTime(subscriber.isPremium)}*`,
    { parse_mode: "Markdown" }
  );
});
bot.command("cancel", ctx => {
  const subscriber = getSubscriber(ctx.chat.id);
  subscriber.variables = null;

  ctx.reply("Your subscription was canceled");
});
bot.command("stop", ctx => {
  subscribers.delete(ctx.chat.id);
});

bot.command("_monitor", ctx => {
  const subscribersArray = Array.from(subscribers.entries());
  const subscribersLog = formatSubscribersLog(subscribersArray);

  ctx.telegram.sendMessage(
    ctx.chat.id,
    `_Last Update:_\n${new Date(lastUpdate).toUTCString()}\n\n` +
      `_Subscribers (${subscribersArray.length}):_${subscribersLog}\n\n`,
    { parse_mode: "Markdown" }
  );
});
bot.command("_regular", ctx => {
  const subscriber = getSubscriber(ctx.chat.id);
  subscriber.isPremium = false;

  ctx.reply("You are regular now");
});
bot.command("_premium", ctx => {
  const subscriber = getSubscriber(ctx.chat.id);
  subscriber.isPremium = true;

  ctx.reply("You are premium now");
});

bot.launch();
