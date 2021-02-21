if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

import { ApolloClient, HttpLink } from "@apollo/client/core";
import { InMemoryCache } from "@apollo/client/cache";
import fetch from "node-fetch";
import { Telegraf } from "telegraf";
import { format } from "date-fns";
import * as fs from "fs";
import * as R from "ramda";
import { iForEach, tillDone } from "./i-ramda";
import { AdvertList, AdvertListBuy } from "../generated/queries";
import {
  AdvertListQuery,
  AdvertListQueryVariables,
  Advert,
  AdvertListBuyQuery,
  AdvertListBuyQueryVariables,
} from "../generated/types";

const BOT_TOKEN = process.env.BOT_TOKEN;

const UPDATE_INTERVAL = 60 * 1000;

const PREMIUM_INTERVAL =
  parseInt(process.env.PREMIUM_INTERVAL_PRIME) * UPDATE_INTERVAL;
const REGULAR_INTERVAL =
  parseInt(process.env.REGULAR_INTERVAL_PRIME) * UPDATE_INTERVAL;
const BUYER_INTERVAL =
  parseInt(process.env._BUYER_INTERVAL_PRIME) * UPDATE_INTERVAL;

const BACKUP_PATH = process.env.BACKUP_PATH;
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL);

const SUBSCRIBERS_BACKUP = !BACKUP_PATH
  ? null
  : `${BACKUP_PATH}/subscribers.json`;

const API = "https://www.bezrealitky.cz/webgraphql";

let lastUpdate = null;

const client = new ApolloClient({
  link: new HttpLink({ uri: API, fetch }),
  cache: new InMemoryCache(),
});

interface ISubscription {
  cursor: number | null;
  variables: AdvertListQueryVariables | null;
  isBuyer: boolean;
}

interface ISubscriber {
  isPremium: boolean;
  subscriptions: ISubscription[];
}

let subscribers = new Map<number, ISubscriber>();

const fetchAdvert = async (
  variables: AdvertListQueryVariables,
  opts?: { isBuyer?: boolean }
) => {
  try {
    if (opts?.isBuyer) {
      const { data } = await client.query<
        AdvertListBuyQuery,
        AdvertListBuyQueryVariables
      >({
        query: AdvertListBuy,
        fetchPolicy: "no-cache",
      });
      return data?.advertList?.list ?? [];
    }

    const { data } = await client.query<
      AdvertListQuery,
      AdvertListQueryVariables
    >({
      query: AdvertList,
      variables,
      fetchPolicy: "no-cache",
    });

    return (data && data.advertList && data.advertList.list) || [];
  } catch (error) {
    console.warn(error);
    return [];
  }
};

const sleep = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

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

const sendAdvert = (chatId: number) => (advert: Advert) => {
  bot.telegram.sendPhoto(chatId, advert.mainImageUrl, {
    caption:
      `[${advert.shortDescription}](${advert.absoluteUrl})\n` +
      `*${advert.priceFormatted}*\n` +
      `[${
        advert.addressUserInput
      }](https://www.google.com/maps/search/${encodeURI(
        advert.addressUserInput.replace(/\s/g, "+")
      )})`,
    // @ts-ignore
    parse_mode: "Markdown",
  });
};

const getNewAdverts = async (subscription: ISubscription) => {
  const results = await fetchAdvert(subscription.variables, {
    isBuyer: subscription.isBuyer,
  });

  if (subscription.cursor == null) {
    return results.slice(0, 1);
  }

  let cursorIndex = results.findIndex((r) => r.id === subscription.cursor);
  if (cursorIndex === -1) {
    cursorIndex = 1;
  }

  return results.slice(0, cursorIndex);
};

const updateSubscriptionCursor = (adverts, subscription) => {
  if (adverts.length === 0) {
    return { ...subscription };
  }

  return {
    ...subscription,
    cursor: adverts[0].id,
  };
};

(async () => {
  while (true) {
    const now = Date.now();
    const timestamp = now - (now % UPDATE_INTERVAL);

    lastUpdate = timestamp;

    await tillDone(
      iForEach(async ([key, subscriber]) => {
        const send = sendAdvert(key);
        const subscriptions = await Promise.all(
          subscriber.subscriptions.map(async (s) => {
            const interval = s.isBuyer
              ? BUYER_INTERVAL
              : subscriber.isPremium
              ? PREMIUM_INTERVAL
              : REGULAR_INTERVAL;
            if (timestamp % interval !== 0) {
              return s;
            }

            const adverts = await getNewAdverts(s);
            adverts.forEach(send);
            return updateSubscriptionCursor(adverts, s);
          })
        );
        subscribers.set(key, { ...subscriber, subscriptions });
      }, subscribers.entries())
    );

    await sleep(UPDATE_INTERVAL);
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
      (err) => {
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

  subscribers.set(chatId, { isPremium: false, subscriptions: [] });
  return subscribers.get(chatId);
};
const sendSubscription = async (ctx: any, subscription: ISubscription) => {
  if (subscription.isBuyer) {
    await ctx.telegram.sendMessage(ctx.chat.id, "*Buyer*", {
      parse_mode: "Markdown",
    });
    return;
  }
  await ctx.telegram.sendLocation(
    ctx.chat.id,
    subscription.variables.location.lat,
    subscription.variables.location.lng
  );
};

const bot = new Telegraf(BOT_TOKEN);
bot.start((ctx) => {
  ctx.reply("Welcome!");
});
bot.on("location", (ctx) => {
  const subscriber = getSubscriber(ctx.chat.id);

  if (!subscriber.isPremium && subscriber.subscriptions.length !== 0) {
    ctx.reply("You have too many subscriptions");
    return;
  }

  const subscription = {
    cursor: null,
    isBuyer: false,
    variables: {
      location: {
        lat: ctx.update.message.location.latitude,
        lng: ctx.update.message.location.longitude,
      },
    },
  };

  subscriber.subscriptions = subscriber.subscriptions.concat([subscription]);
  ctx.reply("You have been subscribed");
});
bot.command("subscription", async (ctx) => {
  const subscriber = getSubscriber(ctx.chat.id);

  if (subscriber.subscriptions.length === 0) {
    await ctx.telegram.sendMessage(ctx.chat.id, `You have no subscriptions`, {
      parse_mode: "Markdown",
    });
    return;
  }

  for (const subscription of subscriber.subscriptions) {
    await sendSubscription(ctx, subscription);
  }
  await ctx.telegram.sendMessage(
    ctx.chat.id,
    `NEXT UPDATE TIME: *${nextUpdateTime(subscriber.isPremium)}*`,
    { parse_mode: "Markdown" }
  );
});
bot.command("radius", async (ctx) => {
  const subscriber = getSubscriber(ctx.chat.id);

  const radiusMatch = ctx.update.message.text.match(/\/radius (\d+) (\d+)/);
  if (radiusMatch == null) {
    ctx.reply(
      "BAD FORMAT: /radius <subscription-number> <subscription-radius>"
    );
    return;
  }

  const index = parseInt(radiusMatch[1]) - 1;
  const radius = parseInt(radiusMatch[2]);

  const subscription = subscriber.subscriptions[index];
  if (subscription == null) {
    ctx.reply(`Subscription #${radiusMatch[1]} doesn't exist`);
    return;
  }

  subscription.variables = R.set(
    R.lensProp("radius"),
    radius,
    subscription.variables
  );

  ctx.reply("Your search radius has been updated");
});
bot.command("cancel", (ctx) => {
  const subscriber = getSubscriber(ctx.chat.id);

  const cancelMatch = ctx.update.message.text.match(/\/cancel (\d+)/);
  if (cancelMatch == null) {
    ctx.reply("BAD FORMAT: /cancel <subscription-number>");
    return;
  }

  const index = parseInt(cancelMatch[1]) - 1;

  const subscription = subscriber.subscriptions[index];
  if (subscription == null) {
    ctx.reply(`Subscription #${cancelMatch[1]} doesn't exist`);
    return;
  }

  subscriber.subscriptions = subscriber.subscriptions
    .slice(0, index)
    .concat(
      subscriber.subscriptions.slice(index + 1, subscriber.subscriptions.length)
    );
  ctx.reply(`Subscription #${cancelMatch[1]} was canceled`);
});
bot.command("stop", (ctx) => {
  subscribers.delete(ctx.chat.id);
});

bot.command("_monitor", (ctx) => {
  const subscribersArray = Array.from(subscribers.entries());
  const subscribersLog = formatSubscribersLog(subscribersArray);

  ctx.telegram.sendMessage(
    ctx.chat.id,
    `_Last Update:_\n${new Date(lastUpdate).toUTCString()}\n\n` +
      `_Subscribers (${subscribersArray.length}):_${subscribersLog}\n\n`,
    { parse_mode: "Markdown" }
  );
});
bot.command("_regular", (ctx) => {
  const subscriber = getSubscriber(ctx.chat.id);
  subscriber.isPremium = false;

  ctx.reply("You are regular now");
});
bot.command("_premium", (ctx) => {
  const subscriber = getSubscriber(ctx.chat.id);
  subscriber.isPremium = true;

  ctx.reply("You are premium now");
});
bot.command("_buyer", (ctx) => {
  const subscriber = getSubscriber(ctx.chat.id);
  const isBuyer = subscriber.subscriptions.some((s) => s.isBuyer === true);
  if (!isBuyer) {
    subscriber.subscriptions = subscriber.subscriptions.concat([
      { isBuyer: true, variables: null, cursor: null },
    ]);
  }

  ctx.reply("You are a buyer now");
});

bot.launch();
