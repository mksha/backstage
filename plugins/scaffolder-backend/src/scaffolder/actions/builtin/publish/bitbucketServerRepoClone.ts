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
import { parseRepoUrl } from './util';
import { Config } from '@backstage/config';
import { Git } from '@backstage/backend-common';

const getRepoInfo = async (opts: {
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
  let remoteUrl = '';
  for (const link of r.links.clone) {
    if (link.name === 'http') {
      remoteUrl = link.href;
    }
  }

  const repoContentsUrl = `${r.links.self[0].href}`;
  return { remoteUrl, repoContentsUrl };
};

/**
 * Creates a new action that initializes a git repository of the content in the workspace
 * and publishes it to Bitbucket Server.
 * @public
 */
export function createPublishBitbucketServerRepoCloneAction(options: {
  integrations: ScmIntegrationRegistry;
  config: Config;
}) {
  const { integrations, config } = options;

  return createTemplateAction<{
    repoUrl: string;
    baseBranch?: string;
    checkoutBranch: string;
    clonePath?: string;
    token?: string;
  }>({
    id: 'publish:bitbucketServer:repo:clone',
    description:
      'Clone a git repository from the Bitbucket Server, create a local branch and checkout to it.',
    schema: {
      input: {
        type: 'object',
        required: ['repoUrl', 'checkoutBranch'],
        properties: {
          repoUrl: {
            title: 'Repository Location',
            type: 'string',
          },
          baseBranch: {
            title: 'Base Branch For Checkout',
            type: 'string',
            description: `Base branch that will be used a base for new branches. The default value is 'master'`,
          },
          checkoutBranch: {
            title: 'Checkout Branch',
            type: 'string',
            description: `Checkout branch that will be created locally and checked out to.`,
          },
          clonePath: {
            title: 'Clone Path',
            type: 'string',
            description: `Path at where repo will be cloned out. Default is current workspace.`,
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
          dir: {
            title: 'Clone path',
            type: 'string',
          },
        },
      },
    },
    async handler(ctx) {
      const {
        repoUrl,
        baseBranch = 'master',
        checkoutBranch,
        clonePath = ctx.workspacePath,
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

      const auth = authConfig.token
        ? {
            token: token!,
          }
        : {
            username: authConfig.username!,
            password: authConfig.password!,
          };

      const git = Git.fromAuth({
        ...auth,
        logger: ctx.logger,
      });

      const { remoteUrl, repoContentsUrl } = await getRepoInfo({
        project,
        repo,
        authorization,
        apiBaseUrl,
      });

      await git.clone({
        url: remoteUrl,
        dir: clonePath,
        ref: baseBranch,
      });
      await git.branch({ dir: clonePath, ref: checkoutBranch });
      await git.checkout({ dir: clonePath, ref: checkoutBranch });

      ctx.output('remoteUrl', remoteUrl);
      ctx.output('repoContentsUrl', repoContentsUrl);
      ctx.output('clonePath', clonePath);
    },
  });
}
