import { PDFDocument, rgb, RGB } from "https://cdn.skypack.dev/pdf-lib@^1.16.0?dts";
import fontkit from "https://cdn.skypack.dev/@pdf-lib/fontkit@^1.0.0?dts";
import { LawResult } from "./LawResult.ts";
import { n2id } from "./db.ts";
import { lawResultSuffix } from "./display.ts";

const size = 12,
    margin = size * 3;

export async function makeConstitution(laws: LawResult[], chatName: string): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create({});

    let page = pdfDoc.addPage();
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(await Deno.readFile("GentiumPlus-R.ttf"), {
        features: { liga: false },
    });

    let nextY = 0;
    const y = () => page.getHeight() - (margin * 1.5 + nextY);
    const maxWidth = page.getWidth() - margin * 2;

    const drawText = (str: string, sizeMultiplier: number, colour: RGB) => {
        page.drawText(str, {
            x: margin,
            y: y(),
            maxWidth,
            lineHeight: size * 1.2,
            font,
            size: size * sizeMultiplier,
            color: colour,
        });

        nextY += size * 1.5;
    };

    drawText(`Laws of ${chatName}`, 2, rgb(0.25, 0.75, 0.25));
    const dateText = new Date()
        .toISOString()
        .replace(/(T|\..+)/g, " ")
        .trim();
    drawText(`Generated at ${dateText} by @MicroVoteBot`, 1, rgb(0.5, 0.5, 0.5));
    nextY += size * 2;

    laws.forEach(result => {
        const { law, status } = result;

        if (nextY > page.getHeight() - margin * 5) {
            nextY = 0;
            page = pdfDoc.addPage();
        }

        drawText(law.Name, 1.5, rgb(0.5, 0.5, 1));

        const statusStr = `(${n2id(law.TimeSec)}) ${status}${lawResultSuffix(result)}.`;
        drawText(statusStr, 1, rgb(0.5, 0.5, 0.5));

        drawText(law.Body, 1, rgb(0, 0, 0));

        nextY +=
            size * 1.5 + numLines(law.Body) * size * 1.2 + numWrappedLines(law.Body) * size * 1.2;
    });

    return await pdfDoc.save();
}

const numWrappedLines = (str: string) =>
    str
        .split("\n")
        .map(l => Math.floor(l.length / 100))
        .reduce((a, b) => a + b);
const numLines = (str: string) => count(str, /\n/g);
const count = (str: string, find: RegExp) => str.match(find)?.length ?? 0;
