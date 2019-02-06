import yargs, { CommandModule } from 'yargs';
import axios from 'axios';
import path from 'path';
import afs from 'async-file';


interface DownloadArguments {
    url: string,
    chunks: number,
    limit: number,
    output: string
}

interface Chunk {
    size: number
    offset: number
}

async function acceptsRanges(headers: any): Promise<boolean> {
    const acceptRangesHeader = headers['accept-ranges'];
    console.log(acceptRangesHeader);
    return !(acceptRangesHeader === 'none' || acceptRangesHeader === undefined);
}

function formatChunk(chunk: Chunk): string {
    return `${chunk.offset}-${chunk.offset + chunk.size}`;
}

function getChunks(
    contentLength: number,
    numberOfChunks: number,
    contentLengthLimit: number): Array<Chunk> {

    if (contentLength > contentLengthLimit) {
        contentLength = contentLengthLimit;
    }

    /*
    Make limit exclusive.
    An inclusive limit would be
    a confusing interface for a caller.
    A caller could potentially make
    the mistake of getting 1 byte to many.
    */
    contentLength -= 1;

    /*
    Chunks/ranges must be whole numbers. Ensure any decimal values
    are redistributed to account for all bytes required.
    */
    const bytesToRedistribute = contentLength % numberOfChunks;
    const chunkSize = (contentLength - bytesToRedistribute) / numberOfChunks;
    const firstChunkSize = chunkSize + bytesToRedistribute;

    const chunks: Array<Chunk> = [];
    let offset = 0;

    chunks.push({ size: firstChunkSize, offset });
    offset += firstChunkSize;

    Array.from({ length: numberOfChunks - 1 }) // already have 1 chunk set
        .forEach(_ => {
            // ensure no duplicate bytes are retrieved
            // e.g 0-100, 101-200 and NOT 0-100, 100-200
            chunks.push({ size: chunkSize - 1, offset: offset + 1 });
            offset += chunkSize;
        });

    return chunks;
};

async function download(url: string, numberOfChunks: number, limit: number) {
    const headResponse = await axios.head(url);

    if (!await acceptsRanges(headResponse.headers)) {
        throw Error(`${url} does not support partial requests.`);
    }

    const contentLength = headResponse.headers['content-length'];
    console.log(`content-length: ${contentLength}`);

    const chunks = getChunks(contentLength, numberOfChunks, limit);

    const responses = await Promise.all(chunks.map(async chunk => {
        const rangeHeader = `bytes=${formatChunk(chunk)}`;
        console.log(`Range: ${rangeHeader}`);

        const response = await axios.get(url, {
            headers: {
                range: rangeHeader,
            },
            responseType: 'arraybuffer'
        });

        return { chunk, response };
    }));

    // confirm all responses return 206 status
    const invalidRespones = responses.filter(response => response.response.status !== 206);

    if (invalidRespones.length !== 0) {
        throw Error(`received invalid responses:\n ${invalidRespones}`);
    }

    // concaterate all data from responses
    // no need to sort chunks, requests were made in order
    return Buffer.concat(responses.map(response => response.response.data));
}

const downloadCommand: CommandModule<{}, DownloadArguments> = {
    command: 'download <url>',
    describe: 'Download file ',
    builder: {
        chunks: {
            describe: 'number of chunks used to download',
            type: 'number',
            default: 4
        },
        limit: {
            describe: 'size limit of file in bytes',
            type: 'number',
            default: (4 * 1024 * 1024) // 4 MB
        },
        output: {
            describe: 'path where file will be written to',
            type: 'string',
            default: `${path.basename(__dirname)}/data`
        }
    },
    handler: async function (args: DownloadArguments) {
        const content = await download(args.url, args.chunks, args.limit);
        await afs.writeFile(args.output, content);
    }
}

async function main() {
    yargs
        .command(downloadCommand)
        .help()
        .argv;
}

main();