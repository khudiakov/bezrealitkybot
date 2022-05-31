if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

export const BOT_TOKEN = process.env.BOT_TOKEN;

export const UPDATE_INTERVAL = 60 * 1000;

export const BACKUP_PATH = process.env.BACKUP_PATH;
export const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL);

export const SUBSCRIBERS_BACKUP = !BACKUP_PATH
  ? null
  : `${BACKUP_PATH}/subscribers.json`;

export const API = "https://api.bezrealitky.cz/graphql/";
export const HOST = "https://www.bezrealitky.com/properties-flats-houses/";

export const INIT_KEYS_ARG_KEY = "keys";
