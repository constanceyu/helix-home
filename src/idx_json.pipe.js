/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const { Pipeline } = require('@adobe/helix-pipeline/index.js');
const { log } = require('@adobe/helix-pipeline/src/defaults/default.js');

const fetch = require('@adobe/helix-pipeline/src/html/fetch-markdown.js');
const parse = require('@adobe/helix-pipeline/src/html/parse-markdown.js');
const meta = require('@adobe/helix-pipeline/src/html/get-metadata.js');
const html = require('@adobe/helix-pipeline/src/html/make-html.js');
const type = require('@adobe/helix-pipeline/src/utils/set-content-type.js');
const selectStatus = require('@adobe/helix-pipeline/src/html/set-status.js');
const smartypants = require('@adobe/helix-pipeline/src/html/smartypants');
const sections = require('@adobe/helix-pipeline/src/html/split-sections');
const { selectstrain, selecttest } = require('@adobe/helix-pipeline/src/utils/conditional-sections');
const debug = require('@adobe/helix-pipeline/src/html/output-debug.js');
const key = require('@adobe/helix-pipeline/src/html/set-surrogate-key');
const production = require('@adobe/helix-pipeline/src/utils/is-production');
const dump = require('@adobe/helix-pipeline/src/utils/dump-context.js');
const validate = require('@adobe/helix-pipeline/src/utils/validate');
const { cache, uncached } = require('@adobe/helix-pipeline/src/html/shared-cache');
const embeds = require('@adobe/helix-pipeline/src/html/find-embeds');
const parseFrontmatter = require('@adobe/helix-pipeline/src/html/parse-frontmatter');
const unwrapSoleImages = require('@adobe/helix-pipeline/src/html/unwrap-sole-images');
const timing = require('@adobe/helix-pipeline/src/utils/timing');
const sanitize = require('@adobe/helix-pipeline/src/html/sanitize');
const resolveRef = require('@adobe/helix-pipeline/src/utils/resolve-ref');

/* eslint newline-per-chained-call: off */

function hascontent({ content }) {
  return !(content !== undefined && content.body !== undefined);
}

function paranoid(context, action) {
  return action && action.secrets && !!action.secrets.SANITIZE_DOM;
}

const jsonpipe = (cont, context, action) => {
  action.logger = action.logger || log;
  action.logger.log('debug', 'Constructing custom JSON Pipeline');
  const pipe = new Pipeline(action);
  const timer = timing();
  pipe
    .every(dump.record)
    .every(validate).when(() => !production())
    .every(timer.update)
    .before(resolveRef).expose('resolve').when(hascontent)
    .before(fetch).expose('fetch').when(hascontent)
    .before(parse).expose('parse')
    .before(parseFrontmatter)
    .before(embeds)
    .before(smartypants)
    .before(sections)
    .before(meta).expose('meta')
    .before(unwrapSoleImages)
    .before(selectstrain)
    .before(selecttest)
    .before(html).expose('html')
    .before(sanitize).when(paranoid)
    .once(cont)
    .after(type('application/json'))
    .after(cache).when(uncached)
    .after(key)
    .after(debug)
    .after(timer.report)
    .error(dump.report)
    .error(selectStatus);

  action.logger.log('debug', 'Running custom JSON pipeline');
  return pipe.run(context);
};

module.exports.pipe = jsonpipe;