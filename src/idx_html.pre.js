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

/* eslint-disable import/no-unresolved */
const htmlPre = require('./html.pre');

/**
 * The 'pre' function that is executed before the HTML is rendered
 * @param context The current context of processing pipeline
 * @param context.content The content
 */
function pre(context) {
  const { document } = context.content;
  htmlPre.pre(context);

  // construct the tables
  const tables = [];
  const basic = { name: 'basic', entries: {} };
  const images = { name: 'images', entries: {} };

  const titleEl = document.querySelector('h1');
  if (titleEl) {
    basic.entries.title = titleEl.textContent;
  }

  document.querySelector('.title .header p', (title) => {
    basic.entries.description = title.textContent;
  });

  const imgs = [];
  document.querySelectorAll('img').forEach((img) => {
    imgs.push(img.src);
  });
  images.entries = { images: imgs };
  tables.push(basic);
  tables.push(images);
  context.content.json = { tables };

  context.content.json.string = JSON.stringify(context.content.json);
}

module.exports.pre = pre;
/**
 * Override fetch step
 */
module.exports.before = {
  fetch: (context, action) => {
    action.secrets = action.secrets || {};
    action.secrets.HTTP_TIMEOUT = 5000;
  },
};
