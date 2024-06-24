/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fetch, { Response, RequestInit } from 'node-fetch';

export const getRepoInfo = async (opts: {
  project: string;
  repo: string;
  authorization: string;
  apiBaseUrl: string;
}) => {
  const { project, repo, authorization, apiBaseUrl } = opts;

  let response: Response;
  const options: RequestInit = {
    method: 'GET',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
  };

  try {
    response = await fetch(
      `${apiBaseUrl}/projects/${project}/repos/${repo}`,
      options,
    );
  } catch (e) {
    throw new Error(`Unable to get repository details, ${e}`);
  }

  if (response.status !== 200) {
    throw new Error(
      `Unable to get repository details, ${response.status} ${
        response.statusText
      }, ${await response.text()}`,
    );
  }

  const r = await response.json();
  const repoId = r.id;
  let remoteUrl = '';
  for (const link of r.links.clone) {
    if (link.name === 'http') {
      remoteUrl = link.href;
    }
  }

  const repoContentsUrl = `${r.links.self[0].href}`;
  return { remoteUrl, repoContentsUrl, repoId };
};

export const getRequiredReviewers = async (opts: {
  projectKey: string;
  repositorySlug: string;
  sourceRepoId: string;
  sourceRefId: string;
  targetRepoId: string;
  targetRefId: string;
  authorization: string;
  apiBaseUrl: string;
}) => {
  const {
    projectKey,
    repositorySlug,
    sourceRepoId,
    sourceRefId,
    targetRepoId,
    targetRefId = 'refs/heads/master',
    authorization,
    apiBaseUrl,
  } = opts;
  let response: Response;
  const options: RequestInit = {
    method: 'GET',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
  };

  const modifiedApiBaseUrl: string = apiBaseUrl.replace(
    'api',
    'default-reviewers',
  );
  try {
    const params = {
      sourceRepoId: sourceRepoId,
      sourceRefId: sourceRefId,
      targetRepoId: targetRepoId,
      targetRefId: targetRefId,
    };
    response = await fetch(
      `${modifiedApiBaseUrl}/projects/${projectKey}/repos/${repositorySlug}/reviewers` +
        `?${new URLSearchParams(params)}`,
      options,
    );
  } catch (e) {
    throw new Error(`Unable to get default reviewers, ${e}`);
  }

  if (response.status !== 200) {
    throw new Error(
      `Unable to get default reviewers, ${response.status} ${
        response.statusText
      }, ${await response.text()}`,
    );
  }

  const requiredReviewers = await response.json();

  return requiredReviewers;
};
