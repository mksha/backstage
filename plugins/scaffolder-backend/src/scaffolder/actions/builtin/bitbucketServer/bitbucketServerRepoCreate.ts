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

import { InputError } from '@backstage/errors';
import {
  getBitbucketServerRequestOptions,
  ScmIntegrationRegistry,
} from '@backstage/integration';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import fetch, { Response, RequestInit } from 'node-fetch';
import { parseRepoUrl } from '../publish/util';
import { Config } from '@backstage/config';
import { Logger } from 'winston';
import { getRepoInfo } from './bitbucketServerUtil';

const createRepository = async (opts: {
  project: string;
  repo: string;
  description?: string;
  repoVisibility: 'private' | 'public';
  defaultBranch: string;
  authorization: string;
  apiBaseUrl: string;
  logger: Logger;
}) => {
  const {
    project,
    repo,
    description,
    authorization,
    repoVisibility,
    defaultBranch,
    apiBaseUrl,
    logger,
  } = opts;

  let response: Response;
  const options: RequestInit = {
    method: 'POST',
    body: JSON.stringify({
      name: repo,
      description: description,
      defaultBranch: defaultBranch,
      public: repoVisibility === 'public',
    }),
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
  };

  try {
    response = await fetch(`${apiBaseUrl}/projects/${project}/repos`, options);
  } catch (e) {
    throw new Error(`Unable to create repository, ${e}`);
  }

  if (response.status === 409) {
    logger.info(`A repository with name(${repo}) already exists.`);
    return getRepoInfo({ project, repo, authorization, apiBaseUrl });
  }

  if (response.status !== 201 && response.status !== 409) {
    throw new Error(
      `Unable to create repository, ${response.status} ${
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

const performEnableLFS = async (opts: {
  authorization: string;
  host: string;
  project: string;
  repo: string;
}) => {
  const { authorization, host, project, repo } = opts;

  const options: RequestInit = {
    method: 'PUT',
    headers: {
      Authorization: authorization,
    },
  };

  const { ok, status, statusText } = await fetch(
    `https://${host}/rest/git-lfs/admin/projects/${project}/repos/${repo}/enabled`,
    options,
  );

  if (!ok)
    throw new Error(
      `Failed to enable LFS in the repository, ${status}: ${statusText}`,
    );
};

/**
 * Creates a new action that initializes a git repository of the content in the workspace
 * and publishes it to Bitbucket Server.
 * @public
 */
export function createBitbucketServerRepoCreateAction(options: {
  integrations: ScmIntegrationRegistry;
  config: Config;
}) {
  const { integrations, config } = options;

  return createTemplateAction<{
    repoUrl: string;
    description?: string;
    defaultBranch?: string;
    repoVisibility?: 'private' | 'public';
    enableLFS?: boolean;
    token?: string;
  }>({
    id: 'bitbucketServer:repo:create',
    description: 'Create a git repository in the Bitbucket Server.',
    schema: {
      input: {
        type: 'object',
        required: ['repoUrl'],
        properties: {
          repoUrl: {
            title: 'Repository Location',
            type: 'string',
          },
          description: {
            title: 'Repository Description',
            type: 'string',
          },
          repoVisibility: {
            title: 'Repository Visibility',
            type: 'string',
            enum: ['private', 'public'],
          },
          defaultBranch: {
            title: 'Default Branch',
            type: 'string',
            description: `Sets the default branch on the repository. The default value is 'master'`,
          },
          enableLFS: {
            title: 'Enable LFS?',
            description: 'Enable LFS for the repository.',
            type: 'boolean',
          },
          token: {
            title: 'Authentication Token',
            type: 'string',
            description:
              'The token to use for authorization to BitBucket Server',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          remoteUrl: {
            title: 'A URL to the repository with the provider',
            type: 'string',
          },
          repoContentsUrl: {
            title: 'A URL to the root of the repository',
            type: 'string',
          },
          repoId: {
            title: 'Repository ID',
            type: 'integer',
          },
        },
      },
    },
    async handler(ctx) {
      const {
        repoUrl,
        description,
        defaultBranch = 'master',
        repoVisibility = 'private',
        enableLFS = false,
      } = ctx.input;

      const { project, repo, host } = parseRepoUrl(repoUrl, integrations);

      if (!project) {
        throw new InputError(
          `Invalid URL provider was included in the repo URL to create ${ctx.input.repoUrl}, missing project`,
        );
      }

      const integrationConfig = integrations.bitbucketServer.byHost(host);
      if (!integrationConfig) {
        throw new InputError(
          `No matching integration configuration for host ${host}, please check your integrations config`,
        );
      }

      const token = ctx.input.token ?? integrationConfig.config.token;

      const authConfig = {
        ...integrationConfig.config,
        ...{ token },
      };
      const reqOpts = getBitbucketServerRequestOptions(authConfig);
      const authorization = reqOpts.headers.Authorization;
      if (!authorization) {
        throw new Error(
          `Authorization has not been provided for ${integrationConfig.config.host}. Please add either (a) a user login auth token, or (b) a token or (c) username + password to the integration config.`,
        );
      }

      const apiBaseUrl = integrationConfig.config.apiBaseUrl;

      const { remoteUrl, repoContentsUrl, repoId } = await createRepository({
        authorization,
        project,
        repo,
        repoVisibility,
        defaultBranch,
        description,
        apiBaseUrl,
        logger: ctx.logger,
      });

      if (enableLFS) {
        await performEnableLFS({ authorization, host, project, repo });
      }

      ctx.output('remoteUrl', remoteUrl);
      ctx.output('repoContentsUrl', repoContentsUrl);
      ctx.output('repoId', repoId);
    },
  });
}
