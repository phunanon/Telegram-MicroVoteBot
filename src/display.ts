import { n2id, secNow } from "./db.ts";
import { Law, Poll } from "./types.ts";
import { formattedDuration, closestSingleDuration } from "./dates.ts";
import { LawResult, LawResultStatus } from "./LawResult.ts";

type ShowPollOptions = { options?: boolean; desc?: boolean; amounts?: boolean };
export function pollText(poll: Poll, show: ShowPollOptions, amounts: number[] = []) {
    const options = show.amounts
        ? poll.Options.map((o, i) => ({ text: o, i, amount: amounts[i] })).sort(
              (a, b) => b.amount - a.amount,
          )
        : poll.Options.map((o, i) => ({ text: o, i, amount: i }));
    const optionList = options
        .map(
            opt =>
                `\n<code>${
                    show.amounts
                        ? `${showChoiceAmount(opt.amount, poll.Width)} ${opt.amount.toFixed(2)}`
                        : ""
                } </code> ${opt.i + 1}. ${opt.text}`,
        )
        .join("");
    return (
        `<code>[${n2id(poll.TimeSec)}]</code> ${showPollTime(poll)} <b>${poll.Name}</b>` +
        (show.desc ? `\n${poll.Desc}` : "") +
        (show.options ? optionList : "")
    );
}

export const lawText = (law: Law) =>
    `<code>(${n2id(law.TimeSec)})</code> <b>${law.Name}</b>\n${law.Body}`;

export const showLawResult = ({ status, law, pc }: LawResult): string =>
    `<b>${status}</b>${
        [LawResultStatus.Accepted, LawResultStatus.Rejected].includes(status)
            ? ` at ${pc.toFixed(2)}% approval.`
            : ""
    }\n${lawText(law)}`;

function showPollTime(poll: Poll): string {
    const diff = poll.TimeSec + poll.Minutes * 60 - secNow();
    return `(${formattedDuration(poll.Minutes * 60)}, ${closestSingleDuration(diff)} ${
        diff > 0 ? "to go" : "ago"
    })`;
}

const repeatStr = (x: string, n: number): string =>
    n < 1 ? "" : [...new Array(Math.floor(n))].map(_ => x).join("");

const unicodeHorizontalBar = (width: number, fraction: number) => {
    fraction = Math.min(1, Math.max(fraction, 0));
    const wholeWidth = Math.floor(fraction * width);
    const remainderWidth = (fraction * width) % 1;
    const endWidth = width - wholeWidth - 1;
    const partWidth = Math.floor(remainderWidth * 8);
    const partChar = endWidth < 0 ? "" : [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][partWidth];
    return repeatStr("▉", wholeWidth) + partChar + repeatStr(" ", endWidth);
};

const showChoiceAmount = (n: number, width: number): string =>
    unicodeHorizontalBar(width, n / width);
