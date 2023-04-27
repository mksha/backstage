# **${{ values.service.team }}**

---

This repository contains the ARGOCD application's configuration owned by ${{ values.service.bitbucketProjectKey }}.${{ values.service.team }} team.

| ⚠WARNING: Before doing any change in this repository, please make sure you have installed [pre-commit](https://pre-commit.com/#install) hook on your local machine and have [enabled it](https://pre-commit.com/#3-install-the-git-hook-scripts) for this repository! |
| --- |

## **Repo structure**

---

```bash
.
├──.gitignore
├──.pre-commit-config.yaml
├── README.md
├── dev
│   ├── applicationset-dr.yaml
│   ├── applicationset.yaml
│   └── apps
│       └── ${{ values.service.team }}
│           ├── us-east-1
│           │   └── ${{ values.k8s.namespace }}
│           │       └── stable.config.yaml
│           └── us-east-2
│               └── ${{ values.k8s.namespace }}
│                   └── stable.config.yaml
├── prod
│   ├── applicationset-dr.yaml
│   ├── applicationset.yaml
│   └── apps
│       └── ${{ values.service.team }}
│           ├── us-east-1
│           │   └── ${{ values.k8s.namespace }}
│           │       └── stable.config.yaml
│           └── us-east-2
│               └── ${{ values.k8s.namespace }}
│                   └── stable.config.yaml
├── qa
│   ├── applicationset-dr.yaml
│   ├── applicationset.yaml
│   └── apps
│       └── ${{ values.service.team }}
│           ├── us-east-1
│           │   └── ${{ values.k8s.namespace }}
│           │       └── stable.config.yaml
│           └── us-east-2
│               └── ${{ values.k8s.namespace }}
│                   └── stable.config.yaml
├── pipelines
│   └── ${{ values.service.team }}
│           └── cicd.yaml
```
