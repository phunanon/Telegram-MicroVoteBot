import { Chat, Poll } from "./types.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const readJson = async (path: string) => {
    const content = await Deno.readTextFile(path);
    await sleep(100);
    return JSON.parse(content);
};

export const writeJson = async (path: string, obj: Chat | Poll) => {
    await Deno.writeTextFile(path, JSON.stringify(obj, null, 2));
    await sleep(100);
};

export const getAllHelp = async (): Promise<{ [action: string]: string }> =>
    await readJson("help.json");
