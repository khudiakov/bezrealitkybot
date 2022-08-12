import { ApolloClient, HttpLink } from "@apollo/client/core";
import { InMemoryCache } from "@apollo/client/cache";
import fetch from "node-fetch";
import { Telegraf } from "telegraf";
import { AdvertList } from "../generated/queries";
import { Advert, AdvertListQuery, AdvertListQueryVariables } from "../generated/types";
import { API, BOT_TOKEN, HOST, UPDATE_INTERVAL, CHANNEL_CHAT_ID } from "./constants";

import PRAGUE_BOUNDARIES from "./boundaries/prague.json";

const client = new ApolloClient({
  link: new HttpLink({ uri: API, fetch }),
  cache: new InMemoryCache(),
});

type AdvertWithId = Advert & { id: string };

const fetchAdvert = async (): Promise<AdvertWithId[]> => {
  const { data } = await client.query<AdvertListQuery, AdvertListQueryVariables>({
    errorPolicy: "ignore",
    query: AdvertList,
    variables: {
      boundaryPoints: PRAGUE_BOUNDARIES as AdvertListQueryVariables["boundaryPoints"],
    },
    fetchPolicy: "no-cache",
  });

  return (data?.listAdverts?.list?.filter((a) => a?.id != null) as AdvertWithId[]) ?? [];
};

const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

const sendAdvert = async (advert: AdvertWithId) => {
  const text =
    `[${advert.id}](${HOST}${advert.uri})\n\n` +
    (advert.addressInput == null
      ? ""
      : `[${advert.addressInput}](https://www.google.com/maps/search/${encodeURI(
          advert.addressInput.replace(/\s/g, "+")
        )})`) +
    `\n` +
    (advert.formattedParameters ?? [])
      .map((p) => (p == null ? undefined : `_${p.title}: ${p.value}_`))
      .filter((p) => p !== undefined)
      .join("\n");

  if (advert.mainImage?.url == null) {
    await bot.telegram.sendMessage(CHANNEL_CHAT_ID, text, {
      parse_mode: "Markdown",
    });
    return;
  }
  await bot.telegram.sendPhoto(CHANNEL_CHAT_ID, advert.mainImage.url, {
    caption: text,
    parse_mode: "Markdown",
  });
};

const getNewAdverts = <T extends { id: string }>(adverts: T[], sentAdvertsIds: string[]) => {
  if (sentAdvertsIds.length === 0) {
    return [];
  }

  return adverts.filter((a) => !sentAdvertsIds.includes(a.id));
};

const MINUTE = 60 * 1000;
const untilNextMinute = () => {
  const left = MINUTE - (Date.now() % MINUTE);
  return left === 0 ? MINUTE : left;
};

const LIMIT_PER_MINUTE = 19;
const waitRaitLimiter = (() => {
  let counter = 0;
  let queue: (() => void)[] = [];

  const clear = () => {
    setTimeout(() => {
      const resolveNext = Math.max(queue.length, LIMIT_PER_MINUTE);
      queue.slice(0, resolveNext).forEach((resolve) => resolve());
      counter = LIMIT_PER_MINUTE - resolveNext;
      clear();
    }, untilNextMinute());
  };
  clear();

  return async () => {
    if (counter >= LIMIT_PER_MINUTE) {
      const promise = new Promise<void>((promiseResolve) => queue.push(promiseResolve));
      return promise;
    }
    counter += 1;
  };
})();

const doSequantallyWithRateLimit = async <T, R>(action: (v: T) => Promise<R>, values: T[]) => {
  const result: { status: "fulfilled" | "rejected"; value: T }[] = [];
  for (const v of values) {
    await waitRaitLimiter();
    try {
      await action(v);
      result.push({ status: "fulfilled", value: v });
    } catch (e) {
      console.error(e);
      result.push({ status: "rejected", value: v });
    }
  }
  return result;
};

(async () => {
  let sentAdvertIds: string[] = [];

  await sleep(untilNextMinute());

  while (true) {
    const allAdverts = await fetchAdvert();
    const newAdverts = getNewAdverts(allAdverts, sentAdvertIds);

    const sendingResults = await doSequantallyWithRateLimit(sendAdvert, newAdverts);
    sentAdvertIds = allAdverts
      .map((a) => a.id)
      .filter((aId) => sendingResults.find((ra) => ra.value.id === aId)?.status !== "rejected");

    await sleep(UPDATE_INTERVAL);
  }
})();

const bot = new Telegraf(BOT_TOKEN!);
bot.start((ctx) => {
  ctx.reply("Subscribe to @bezrealitky channel and follow new apartments for renting!");
});

bot.command("ping", (ctx) => {
  ctx.reply("pong");
});

bot.launch();
