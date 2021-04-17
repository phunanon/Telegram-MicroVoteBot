import { calcQuorum } from "./db.ts";
import { Poll } from "./types.ts";

export const calcPollQuorum = (poll: Poll): number => calcQuorum(poll.ChatPop, poll.Quorum);

export type PollResult = {
    poll: Poll;
    reachedQuorum: boolean;
    averages: { [option: string]: number };
};

export function calcPollResult(poll: Poll): PollResult {
    const votes = Object.values(poll.Votes);
    const sums = votes.reduce(
        (sums, v) => sums.map((s, i) => s + v.Choices[i]),
        poll.Options.map(() => 0),
    );
    return {
        poll,
        reachedQuorum: calcQuorum(poll.ChatPop, poll.Quorum) <= votes.length,
        averages: Object.fromEntries(sums.map((s, i) => [poll.Options[i], s / votes.length || 0])),
    };
}
