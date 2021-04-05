import { Law, getPoll, getPollResult } from "./db.ts";
import { lawIdRegex } from "./index.ts";

export enum LawResultStatus {
    NeverPolled = "Has never been included in a poll.",
    PollNonexist = "Historical poll no longer exists.",
    Accepted = "Accepted",
    Rejected = "Rejected"
}

export type LawResult = { status: LawResultStatus; law: Law; pc: number; };

export async function lawResult(law: Law): Promise<LawResult> {
    if (!law.LatestPollId) {
        return { status: LawResultStatus.NeverPolled, law, pc: 0 };
    }
    const { poll } = await getPoll(law.LatestPollId);
    if (!poll) {
        return { status: LawResultStatus.PollNonexist, law, pc: 0 };
    }
    const avgs = await getPollResult(poll);
    const pc = (avgs.find(o => lawIdRegex.test(o.Option))?.Average ?? 0) / poll.Width * 100;
    return { status: pc >= 50 ? LawResultStatus.Accepted : LawResultStatus.Rejected, law, pc };
}
