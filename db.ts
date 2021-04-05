import { exists } from "https://deno.land/std/fs/mod.ts";

interface Vote {
    TimeMs: number,
    Choices: number,
}

export interface Ballot {
    TimeMs: number,
    ChatId: string,
    Minutes: number,
    Name: string,
    Desc: string,
    Options: string[],
    Votes: {[voterId: number]: Vote},
}

type Chat = {[userId2LastSeen: number]: number};

const readJson = async (path: string) => JSON.parse(await Deno.readTextFile(path));
const writeJson = async (path: string, obj: any) => await Deno.writeTextFile(path, JSON.stringify(obj));

export async function newBallot(ballot: Ballot) {
    const fileName = `db/ballot-${ballot.TimeMs}.json`;
    await writeJson(fileName, ballot);
}

export async function castVote(ballotId: number, userId: number, vote: Vote): Promise<boolean> {
    const fileName = `db/ballot-${ballotId}.json`;
    const ballot = await readJson(fileName) as Ballot;
    if (userCanVote(ballot, userId)) {
        ballot.Votes[userId] = vote;
        await writeJson(fileName, ballot);
        return true;
    } else {
        return false;
    }
}

export async function logUser(chatId: number, userId: number) {
    const fileName = `db/chat-${chatId}.json`;
    if (!(await exists(fileName))) {
        await writeJson(fileName, {});
    }
    const users = await readJson(fileName) as Chat;
    users[userId] = Date.now();
    await writeJson(fileName, users);
}

export async function getBallots(): Promise<Ballot[]> {
    const files = [...Deno.readDirSync("./db")].filter(d => d.isFile && d.name.startsWith("ballot"));
    return Promise.all(files.map(async f => await readJson(`db/${f.name}`) as Ballot));
}

export async function userCanVote(ballot: Ballot, userId: number): Promise<boolean> {
    const fileName = `db/chat-${ballot.ChatId}.json`;
    if (!(await exists(fileName))) {
        return false;
    }
    const users = (await readJson(fileName)) as Chat;
    if (!users[userId]) {
        return false;
    }
    const lastSeen = users[userId];
    return lastSeen < ballot.TimeMs + (ballot.Minutes * 60000);
}
