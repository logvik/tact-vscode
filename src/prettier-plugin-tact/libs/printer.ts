import * as types from '../types';
import ignoreComments from '../types/comments/ignore';

const arrayTypes: any = types;

import { hasNodeIgnoreComment, prettierVersionSatisfies } from './util';

let checked = false;

function prettierVersionCheck() {
  if (checked) return;
  if (!prettierVersionSatisfies('>=2.3.0 || >=3.0.0-alpha.0')) {
    throw new Error(
      'The version of prettier in your node-modules does not satisfy the required ">=2.3.0" constraint. Please update the version of Prettier.'
    );
  }
  checked = true;
}

function genericPrint(path: any, options: any, print: any) {
  prettierVersionCheck();

  const node = path.getValue();

  if (node === null || node == undefined) {
    return '';
  }

  if (!(node.type in types)) {
    throw new Error(`Unknown type: ${JSON.stringify(node.type)}`);
  }

  if (hasNodeIgnoreComment(node)) {
    ignoreComments(path);

    return options.originalText.slice(
      options.locStart(node),
      options.locEnd(node) + 1
    );
  }

  return arrayTypes[node.type].print({ node, options, path, print });
}

export default genericPrint;
