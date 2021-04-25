const { abs, floor } = Math;

const mD = 60,
    hD = mD * 60,
    dD = hD * 24,
    yD = dD * 365.25,
    moD = yD / 12;
const suffixes = [..."yMdhms"];

export function closestSingleDuration(secsDuration: number) {
    const s = abs(secsDuration);
    const times = [s / yD, s / moD, s / dD, s / hD, s / mD, s];
    const first = times.findIndex(n => n >= 1);
    return first == -1 ? "0s" : floor(times[first]) + suffixes[first];
}

export function formattedDuration(secsDuration: number): string {
    const years = floor(secsDuration / yD);
    secsDuration -= years * yD;
    const months = floor(secsDuration / moD);
    secsDuration -= months * moD;
    const days = floor(secsDuration / dD);
    secsDuration -= days * dD;
    const hours = floor(secsDuration / hD);
    secsDuration -= hours * hD;
    const minutes = floor(secsDuration / mD);
    return [years, months, days, hours, minutes]
        .map((n, i) => ({ n, s: suffixes[i] }))
        .filter(({ n }) => n > 0)
        .map(({ n, s }) => n + s)
        .join("");
}

/// Takes a string like "5m 2h 10d 4M 5y" and converts to minutes
export const toMin = (period: string): number =>
    period.split(" ").reduce((min, txt) => {
        const { n, t } = txt.match(/(?<n>\d+)(?<t>[mhdMy])/)?.groups ?? {};
        const m = 1,
            h = m * 60,
            d = h * 24,
            y = d * 365,
            M = y / 12;
        const times: { [key: string]: number } = { m, h, d, M, y };
        return min + parseInt(n) * (times[t] || 0);
    }, 0);
