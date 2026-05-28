const axios = require('axios');

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GROUP_ID = '111210875';
const PACKAGE_NAME = '@dwp-govuk/govuk-prototype-kit';

const BASE_URL = 'https://gitlab.com/api/v4';

if (!GITLAB_TOKEN) {
  throw new Error('Missing GITLAB_TOKEN environment variable');
}

/**
 * Create a locked-down Axios client
 * Prevents SSRF by fixing the base URL
 */
const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${GITLAB_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

/**
 * Validation helpers
 */
function isValidProjectId(id) {
  return Number.isInteger(id) || /^[0-9]+$/.test(String(id));
}

function isValidBranch(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9._\-\/]+$/.test(name);
}

/**
 * Fetch all projects in group (handles pagination)
 */
async function getProjects() {
  let page = 1;
  const perPage = 100;
  let allProjects = [];

  while (true) {
    const res = await client.get(`/groups/${encodeURIComponent(GROUP_ID)}/projects`, {
      params: { per_page: perPage, page }
    });

    if (!Array.isArray(res.data) || res.data.length === 0) {
      break;
    }

    allProjects = allProjects.concat(res.data);
    page++;
  }

  return allProjects;
}

/**
 * Create MR for a given project
 */
// nosemgrep: javascript-ssrf-rule-node_ssrf
async function createMR(projectId, defaultBranch) {
  if (!isValidProjectId(projectId)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }

  if (!isValidBranch(defaultBranch)) {
    throw new Error(`Invalid branch: ${defaultBranch}`);
  }

  const safeProjectId = encodeURIComponent(projectId);
  const safeDefaultBranch = encodeURIComponent(defaultBranch);
  const branch = `update-dwp-kit-${Date.now()}`;

  try {
    /**
     * 1. Create branch
     */
    await client.post(`/projects/${safeProjectId}/repository/branches`, {
      branch,
      ref: defaultBranch
    });

    /**
     * 2. Fetch package.json
     */
    const filePath = 'package.json';

    const file = await client.get(
      `/projects/${safeProjectId}/repository/files/${encodeURIComponent(filePath)}`,
      {
        params: { ref: defaultBranch }
      }
    );

    const decodedContent = Buffer.from(file.data.content, 'base64').toString();
    const content = JSON.parse(decodedContent);

    /**
     * Skip if dependency not present
     */
    if (!content.dependencies || !content.dependencies[PACKAGE_NAME]) {
      console.log(`Skipping ${projectId} (not using kit)`);
      return;
    }

    /**
     * 3. Update dependency
     */
    content.dependencies[PACKAGE_NAME] = 'latest';

    await client.put(
      `/projects/${safeProjectId}/repository/files/${encodeURIComponent(filePath)}`,
      {
        branch,
        content: JSON.stringify(content, null, 2),
        commit_message: 'Update DWP Prototype Kit to latest'
      }
    );

    /**
     * 4. Create Merge Request
     */
    await client.post(`/projects/${safeProjectId}/merge_requests`, {
      source_branch: branch,
      target_branch: defaultBranch,
      title: 'Update DWP Prototype Kit',
      description: 'Automated update to latest version'
    });

    console.log(`MR created for project ${projectId}`);
  } catch (err) {
    /**
     * Better error reporting
     */
    if (axios.isAxiosError(err)) {
      console.error(
        `API error for project ${projectId}:`,
        err.response?.status,
        err.response?.data || err.message
      );
    } else {
      console.error(`Unexpected error for project ${projectId}:`, err.message);
    }
  }
}

/**
 * Main execution
 */
(async () => {
  try {
    const projects = await getProjects();

    console.log(`Found ${projects.length} projects`);

    for (const project of projects) {
      if (!project?.id || !project?.default_branch) {
        console.warn(`Skipping invalid project entry:`, project?.name);
        continue;
      }

      await createMR(project.id, project.default_branch);
    }

    console.log('Script completed');
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
})();