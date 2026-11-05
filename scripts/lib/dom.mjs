// A DOM for Node, so the scripts and tests run the exact parser the admin page runs.
import { DOMParser } from 'linkedom';

export const htmlToDoc = (html) => new DOMParser().parseFromString(String(html), 'text/html');
