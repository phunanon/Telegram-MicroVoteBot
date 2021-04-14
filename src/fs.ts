import { Chat, Poll } from "./types.ts";

export const readJson = async (path: string) => JSON.parse(await Deno.readTextFile(path));

export const writeJson = async (path: string, obj: any) =>
    await Deno.writeTextFile(path, JSON.stringify(obj, null, 2));

export const getAllHelp = async (): Promise<{ [action: string]: string }> =>
    await readJson("help.json");
