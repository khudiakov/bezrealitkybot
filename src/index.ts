import { ApolloClient, HttpLink } from "@apollo/client/core";
import { InMemoryCache } from "@apollo/client/cache";
import fetch from "node-fetch";
import { Telegraf } from "telegraf";
import * as fs from "fs";
import { AdvertList } from "../generated/queries";
import {
  AdvertListQuery,
  AdvertListQueryVariables,
  Advert,
} from "../generated/types";
import {
  API,
  BACKUP_INTERVAL,
  BOT_TOKEN,
  INIT_KEYS_ARG_KEY,
  PRAGUE_IDS,
  SUBSCRIBERS_BACKUP,
  UPDATE_INTERVAL,
} from "./constants";

type TAdvertType = AdvertListQuery["advertList"]["list"][0];

interface ISubscriber {
  timestamp: number;
}

const client = new ApolloClient({
  link: new HttpLink({ uri: API, fetch }),
  cache: new InMemoryCache(),
});

let subscribers = new Map<number, ISubscriber>();

const fetchAdvert = async () => {
  try {
    const { data } = await client.query<
      AdvertListQuery,
      AdvertListQueryVariables
    >({
      query: AdvertList,
      variables: {
        ids: PRAGUE_IDS,
      },
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
      (advert.addressUserInput == null
        ? ""
        : `[${
            advert.addressUserInput
          }](https://www.google.com/maps/search/${encodeURI(
            advert.addressUserInput.replace(/\s/g, "+")
          )})`),
    // @ts-ignore
    parse_mode: "Markdown",
  });
};

const getNewAdverts = (adverts: TAdvertType[], prevAdvertsIds: number[]) => {
  if (prevAdvertsIds.length === 0) {
    return adverts.slice(0, 1);
  }

  let cursorIndex = adverts.findIndex((r) => prevAdvertsIds.includes(r.id));
  if (cursorIndex === -1) {
    cursorIndex = 1;
  }

  return adverts.slice(0, cursorIndex);
};

const initKeysArgRegExp = new RegExp(
  `^${INIT_KEYS_ARG_KEY}=\\[(\\d+\\,)*(\\d+)\\]$`,
  "i"
);
const initKeysArg = process.argv
  .slice(2)
  .find((arg) => initKeysArgRegExp.test(arg));
if (initKeysArg) {
  const initKeys = JSON.parse(initKeysArg.slice(INIT_KEYS_ARG_KEY.length + 1));
  initKeys.forEach((k) => {
    subscribers.set(k, { timestamp: Date.now() });
  });
}

(async () => {
  let prevAdvertsIds = [];

  while (true) {
    const allAdverts = await fetchAdvert();
    const newAdverts = await getNewAdverts(allAdverts, prevAdvertsIds);
    prevAdvertsIds = allAdverts.map((a) => a.id);

    for (const subscriberKey of subscribers.keys()) {
      const send = sendAdvert(subscriberKey);
      newAdverts.forEach(send);
    }

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

const bot = new Telegraf(BOT_TOKEN);
bot.start((ctx) => {
  ctx.reply("Welcome!");
  const chatId = ctx.chat.id;
  console.log(`add ${chatId}`);
  subscribers.set(ctx.chat.id, { timestamp: Date.now() });
});
bot.command("stop", (ctx) => {
  const chatId = ctx.chat.id;
  console.log(`delete ${chatId}`);
  subscribers.delete(chatId);
});

bot.command("_monitor", (ctx) => {
  const subscribersArray = Array.from(subscribers.entries());
  const subscribersLog = formatSubscribersLog(subscribersArray);

  ctx.telegram.sendMessage(
    ctx.chat.id,
    `_Subscribers (${subscribersArray.length}):_${subscribersLog}\n\n`,
    { parse_mode: "Markdown" }
  );
});

bot.launch();
