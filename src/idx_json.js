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
const jsonPre = require('./json.pre');

console.log('hi', jsonPre);
/**
 * The 'pre' function that is executed before the HTML is rendered
 * @param context The current context of processing pipeline
 * @param context.content The content
 */
async function main(context) {
  console.log('main');
  const { document } = context.content;
  jsonPre.pre(context);
  console.log('context is this blah', context)

  // construct the tables
  const tables = {};
  const basic = { name: 'basic', entries: {} };
  const images = { name: 'images', entries: {} };

  const titleEl = document.querySelector('h1');
  if (titleEl) {
    basic.entries.title = titleEl.textContent;
  }

  const descEl = document.querySelector('.title .header p');
  if (descEl) {
    basic.entries.description = descEl.textContent;
  }

  const imgs = [];
  document.querySelectorAll('img').forEach((img) => {
    imgs.push(img.src);
  });
  images.entries = { images: imgs };
  tables['basic'] = (basic);
  tables['images'] = (images);

  return {
    response: {
      body: tables,
    }
  };
}

module.exports.main = main;