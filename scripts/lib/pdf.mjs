// pdf.js for Node (scripts and tests), same version the admin page loads from cdnjs.
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfLines } from '../../assets/js/lib/pdf.js';

export const pdfFileLines = (path) => readPdfLines(pdfjs, new Uint8Array(readFileSync(path)));
