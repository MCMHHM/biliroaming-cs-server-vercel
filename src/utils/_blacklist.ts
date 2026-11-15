import * as env from "../_config";
import * as blacklist_notion from "./notion-database/_blacklist";

export const addNewUser = async (
  UID: number,
  type: 0 | 1 | 2 = 0,
  reason = "",
  ban_until = 0
) => {
  const res = await env.db_bitio_pool.query(
    "INSERT INTO blacklist (uid,type,reason,ban_until) VALUES ($1,$2,$3,$4)",
    [UID, type, reason, ban_until]
  );
  return res;
};

export const format_bitio = async (UID: number) => {
  const data = await env.db_bitio_pool
    .query("SELECT * FROM blacklist WHERE uid = $1", [UID])
    .then((res) => res.rows[0]);
  console.log(data);
  if (data) {
    if (data.type == 1)
      await env.db_bitio_pool
        .query("DELETE FROM blacklist WHERE ban_until <= $1 AND type = 1", [
          Date.now(),
        ])
        .then((res) => console.log(res)); //TODO 修改为标准log(pino)
    return {
      code: 0,
      message: "",
      data: {
        uid: Number(data.uid),
        is_blacklist: data.type == 1 ? true : false,
        is_whitelist: data.type == 2 ? true : false,
        status: Number(data.type),
        ban_until: Number(data.ban_until),
      },
    };
  } else {
    return {
      code: 400,
      message: "Invalid UID",
    };
  }
};

const notInList = (UID: number, message = "") => ({
  code: 0,
  message,
  data: {
    uid: UID,
    is_blacklist: false,
    is_whitelist: false,
    status: 0,
    ban_until: 0,
  },
});

//获取公共黑名单，失败(超时、DNS失效、返回异常)时返回 null，不影响主流程
const fetchPublicBlacklist = async (UID: number) => {
  if (!env.public_blacklist) return null;
  try {
    const res = await fetch(env.public_blacklist + UID, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.data || typeof data.data.status !== "number") return null;
    return data as {
      code: number;
      message: string;
      data: { status: 0 | 1 | 2; is_blacklist: boolean; ban_until: number };
    };
  } catch (err) {
    env.logger.warn({ err, UID }, "获取公共黑名单失败，已跳过");
    return null;
  }
};

export const main = async (UID: number) => {
  try {
    if (!env.db_NOTION_blacklist && !env.db_bitio_enabled) {
      if (env.public_blacklist_enabled) {
        const data = await fetchPublicBlacklist(UID);
        if (data) return data;
      }
      return notInList(UID, "未启用黑名单数据库");
    }
    if (env.db_NOTION_blacklist) {
      const res_notion = await blacklist_notion.main(UID);
      if (res_notion.code === 0) return res_notion;
    }
    const res = await format_bitio(UID);
    if (res.code === 0) return res;
    else if (/^[1-9]\d*$/.test(UID.toString())) {
      if (env.public_blacklist_enabled) {
        const data = await fetchPublicBlacklist(UID);
        if (data) {
          await addNewUser(
            UID,
            data.data.status,
            data.data.is_blacklist ? "本用户已进入公共黑名单" : "",
            data.data.ban_until
          );
          return data;
        }
      }
      await addNewUser(UID);
      return notInList(UID);
    } else {
      return res;
    }
  } catch (err) {
    env.logger.error({ err, UID }, "黑名单查询失败，已按未列入处理");
    return notInList(UID, "黑名单查询失败");
  }
};
