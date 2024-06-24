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
import { getRepoInfo, getRequiredReviewers } from './bitbucketServerUtil';
import { Config } from '@backstage/config';
import { Logger } from 'winston';

type User = {
  user: Record<string, string>;
};

const getReviewers = async (opts: {
  users: string[];
  requiredReviewers: any;
  logger: Logger;
}) => {
  const { users, requiredReviewers, logger } = opts;
  const reviewers: User[] = [];
  const requiredUsers: string[] = [];

  for (let _index = 0; _index < requiredReviewers.length; _index++) {
    requiredUsers.push(requiredReviewers[_index].name);
    reviewers.push({ user: { name: requiredReviewers[_index].name } });
  }

  for (const user of users) {
    if (requiredUsers.includes(user)) {
      continue;
    } else {
      reviewers.push({ user: { name: user } });
    }
  }

  return reviewers;
};

const createPullRequest = async (opts: {
  title: string;
  description: string;
  project: string;
  repo: string;
  sourceBranch: string;
  targetBranch: string;
  reviewers?: string[];
  authorization: string;
  apiBaseUrl: string;
  logger: Logger;
}) => {
  const {
    project,
    repo,
    title,
    description,
    sourceBranch,
    targetBranch,
    reviewers = [],
    authorization,
    apiBaseUrl,
    logger,
  } = opts;

  let response: Response;

  const repoInfo = await getRepoInfo({
    project,
    repo,
    authorization,
    apiBaseUrl,
  });

  const requiredReviewers = await getRequiredReviewers({
    projectKey: project,
    repositorySlug: repo,
    sourceRepoId: repoInfo.repoId,
    sourceRefId: `refs/heads/${sourceBranch}`,
    targetRepoId: repoInfo.repoId,
    targetRefId: `refs/heads/${targetBranch}`,
    authorization,
    apiBaseUrl,
  });

  let reviewersObject;
  if (reviewers) {
    reviewersObject = await getReviewers({
      users: reviewers,
      requiredReviewers,
      logger,
    });
  } else {
    reviewersObject = requiredReviewers;
  }

  const options: RequestInit = {
    method: 'POST',
    body: JSON.stringify({
      title: title,
      description: description ?? title,
      reviewers: reviewersObject,
      fromRef: {
        repository: {
          slug: repo,
          project: {
            key: project,
          },
        },
        id: `refs/heads/${sourceBranch}`,
        type: 'BRANCH',
      },
      toRef: {
        repository: {
          slug: repo,
          project: {
            key: project,
          },
        },
        id: `refs/heads/${targetBranch}`,
        type: 'BRANCH',
      },
    }),
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
  };

  try {
    response = await fetch(
      `${apiBaseUrl}/projects/${project}/repos/${repo}/pull-requests`,
      options,
    );
  } catch (e) {
    throw new Error(`Unable to create pull request, ${e}`);
  }

  if (response.status !== 201) {
    throw new Error(
      `Unable to create pull request, ${response.status} ${
        response.statusText
      }, ${await response.text()}`,
    );
  }

  const r = await response.json();
  let remoteUrl = '';
  try {
    for (const link of r.fromRef.repository.links.clone) {
      if (link.name === 'http') {
        remoteUrl = link.href;
      }
    }
    const prUrl = r.links.self[0].href;
    return { remoteUrl, prUrl };
  } catch (e) {
    throw new Error(
      `Unable to create pull request,${JSON.stringify(r)},  ${e}`,
    );
  }
};

/**
 * Creates a new action that checkout a new git branch of the content in the workspace
 * create a PR out of it to Bitbucket Server.
 * @public
 */
export function createBitbucketServerPullRequestOpenAction(options: {
  integrations: ScmIntegrationRegistry;
  config: Config;
}) {
  const { integrations, config } = options;

  return createTemplateAction<{
    repoUrl: string;
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    reviewers?: string[];
    sourcePath?: string;
    token?: string;
  }>({
    id: 'bitbucketServer:pullRequest:open',
    description:
      'Checkouts a git branch of repository of the content in the workspace, and creates a PR out of it to Bitbucket Server.',
    schema: {
      input: {
        type: 'object',
        required: [
          'repoUrl',
          'title',
          'description',
          'sourceBranch',
          'targetBranch',
        ],
        properties: {
          repoUrl: {
            title: 'Repository Location',
            type: 'string',
          },
          title: {
            title: 'PR Title',
            type: 'string',
            description: `Sets the pull request title. The default value is 'Update by backstage'`,
          },
          description: {
            title: 'Pull Request Description',
            type: 'string',
            description: 'The description of the pull request',
          },
          sourceBranch: {
            title: 'Source Branch',
            type: 'string',
            description: `Sets the source branch for the pull request. The default value is 'feature/update-by-backstage'`,
          },
          targetBranch: {
            title: 'Target Branch',
            type: 'string',
            description: `Sets the target branch for the pull request. The default value is 'master'`,
          },
          reviewers: {
            title: 'PR Reviewers',
            type: 'array',
            items: {
              type: 'string',
            },
            description: `Sets the list of reviewers for the pull request. The default value is '[]'`,
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
        },
      },
      output: {
        type: 'object',
        properties: {
          prUrl: {
            title: 'A URL to the pull request',
            type: 'string',
          },
        },
      },
    },
    async handler(ctx) {
      const {
        repoUrl,
        title,
        description,
        sourceBranch,
        targetBranch,
        reviewers = [],
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

      ctx.logger.info(
        `Creating pull request {repo: ${repoUrl}, sourceBranch: ${sourceBranch}, targetBranch: ${targetBranch}`,
      );
      const { remoteUrl, prUrl } = await createPullRequest({
        authorization,
        project,
        repo,
        title,
        description,
        sourceBranch,
        targetBranch,
        reviewers,
        apiBaseUrl,
        logger: ctx.logger,
      });

      ctx.logger.info(`Created pull request: ${prUrl}`);
      ctx.output('remoteUrl', remoteUrl);
      ctx.output('prUrl', prUrl);
    },
  });
}
