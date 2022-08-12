if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

export const BOT_TOKEN = process.env.BOT_TOKEN;

export const CHANNEL_CHAT_ID = -1001700251561;

export const UPDATE_INTERVAL = 60 * 1000;

export const API = "https://api.bezrealitky.cz/graphql/";
export const HOST = "https://www.bezrealitky.com/properties-flats-houses/";
