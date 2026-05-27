const axios = require('axios');

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GROUP_ID = '111210875'; // e.g. dwp/user-centred-design
const PACKAGE_NAME = '@dwp-govuk/govuk-prototype-kit';

const API = 'https://gitlab.com/api/v4';

async function getProjects() {
  const res = await axios.get(`${API}/groups/${GROUP_ID}/projects`, {
    headers: { Authorization: `Bearer ${GITLAB_TOKEN}` }
  });
  return res.data;
}

async function createMR(projectId, defaultBranch) {
  const branch = `update-dwp-kit-${Date.now()}`;

  // 1. create branch
  await axios.post(
    `${API}/projects/${projectId}/repository/branches`,
    {
      branch,
      ref: defaultBranch
    },
    { headers: { Authorization: `Bearer ${GITLAB_TOKEN}` } }
  );

  // 2. update package.json
  const filePath = 'package.json';

  const file = await axios.get(
    `${API}/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}?ref=${defaultBranch}`,
    { headers: { Authorization: `Bearer ${GITLAB_TOKEN}` } }
  );

  const content = JSON.parse(
    Buffer.from(file.data.content, 'base64').toString()
  );

  if (!content.dependencies || !content.dependencies[PACKAGE_NAME]) {
    console.log(`Skipping ${projectId} (not using kit)`);
    return;
  }

  content.dependencies[PACKAGE_NAME] = 'latest';

  await axios.put(
    `${API}/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}`,
    {
      branch,
      content: JSON.stringify(content, null, 2),
      commit_message: 'Update DWP Prototype Kit to latest'
    },
    { headers: { Authorization: `Bearer ${GITLAB_TOKEN}` } }
  );

  // 3. create MR
  await axios.post(
    `${API}/projects/${projectId}/merge_requests`,
    {
      source_branch: branch,
      target_branch: defaultBranch,
      title: 'Update DWP Prototype Kit',
      description: 'Automated update to latest version'
    },
    { headers: { Authorization: `Bearer ${GITLAB_TOKEN}` } }
  );

  console.log(`✅ MR created for project ${projectId}`);
}

(async () => {
  const projects = await getProjects();

  for (const project of projects) {
    try {
      await createMR(project.id, project.default_branch);
    } catch (err) {
      console.error(`❌ Failed for ${project.name}`, err.message);
    }
  }
})();
