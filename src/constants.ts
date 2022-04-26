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

export const API = "https://www.bezrealitky.cz/webgraphql";

export const PRAGUE_IDS = [
  713512,
  715205,
  708954,
  647423,
  713379,
  369890,
  288880,
  715878,
  715877,
  715876,
  714329,
  715268,
  420458,
  715263,
  715858,
];

export const INIT_KEYS_ARG_KEY = "keys";
