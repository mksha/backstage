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

import { initRepoAndPush } from '../helpers';
import { getRepoSourceDirectory, parseRepoUrl } from './util';
import { Config } from '@backstage/config';

const getRepositoryRemoteUrl = async (opts: {
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

  return remoteUrl;
};

/**
 * Creates a new action that checkout a new git branch of the content in the workspace
 * create a PR out of it to Bitbucket Server.
 * @public
 */
export function createPublishBitbucketServerPushAction(options: {
  integrations: ScmIntegrationRegistry;
  config: Config;
}) {
  const { integrations, config } = options;

  return createTemplateAction<{
    repoUrl: string;
    targetBranch?: string;
    sourcePath?: string;
    token?: string;
    gitCommitMessage?: string;
    gitAuthorName?: string;
    gitAuthorEmail?: string;
  }>({
    id: 'publish:bitbucketServer:push',
    description:
      'Checkouts a git branch of repository of the content in the workspace, and creates a PR out of it to Bitbucket Server.',
    schema: {
      input: {
        type: 'object',
        required: ['repoUrl', 'targetBranch'],
        properties: {
          repoUrl: {
            title: 'Repository Location',
            type: 'string',
          },
          targetBranch: {
            title: 'Target Branch',
            type: 'string',
            description: `Sets the target branch for the pull request. The default value is 'master'`,
          },
          sourcePath: {
            title: 'Source Path',
            description:
              'Path within the workspace that will be used as the repository root. If omitted, the entire workspace will be published as the repository PR.',
            type: 'string',
          },
          token: {
            title: 'Authentication Token',
            type: 'string',
            description:
              'The token to use for authorization to BitBucket Server',
          },
          gitCommitMessage: {
            title: 'Git Commit Message',
            type: 'string',
            description: `Sets the commit message on the repository. The default value is 'initial commit'`,
          },
          gitAuthorName: {
            title: 'Author Name',
            type: 'string',
            description: `Sets the author name for the commit. The default value is 'Scaffolder'`,
          },
          gitAuthorEmail: {
            title: 'Author Email',
            type: 'string',
            description: `Sets the author email for the commit.`,
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
          commitHash: {
            title: 'The git commit hash of the initial commit',
            type: 'string',
          },
        },
      },
    },
    async handler(ctx) {
      const {
        repoUrl,
        targetBranch = 'backstage/update',
        gitCommitMessage = 'commit by backstage',
        gitAuthorName,
        gitAuthorEmail,
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

      const gitAuthorInfo = {
        name: gitAuthorName
          ? gitAuthorName
          : config.getOptionalString('scaffolder.defaultAuthor.name'),
        email: gitAuthorEmail
          ? gitAuthorEmail
          : config.getOptionalString('scaffolder.defaultAuthor.email'),
      };

      const auth = authConfig.token
        ? {
            token: token!,
          }
        : {
            username: authConfig.username!,
            password: authConfig.password!,
          };

      const remoteUrl = await getRepositoryRemoteUrl({
        project,
        repo,
        authorization,
        apiBaseUrl,
      });
      const commitResult = await initRepoAndPush({
        dir: getRepoSourceDirectory(ctx.workspacePath, ctx.input.sourcePath),
        remoteUrl,
        auth,
        defaultBranch: targetBranch,
        logger: ctx.logger,
        commitMessage: gitCommitMessage
          ? gitCommitMessage
          : config.getOptionalString('scaffolder.defaultCommitMessage'),
        gitAuthorInfo,
      });

      ctx.output('commitHash', commitResult?.commitHash);
      ctx.output('remoteUrl', remoteUrl);
    },
  });
}
