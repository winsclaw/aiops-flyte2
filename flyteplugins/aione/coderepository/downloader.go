package coderepository

import (
	"encoding/json"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"

	"google.golang.org/protobuf/types/known/structpb"
)

const (
	EnvName   = "AIONE_CODE_REPOSITORIES"
	SecretKey = "code_repositories"
)

type Mount struct {
	ID        string `json:"id"`
	RepoURL   string `json:"repoUrl"`
	Branch    string `json:"branch"`
	MountPath string `json:"mountPath"`
	Token     string `json:"token,omitempty"`
}

func ParseMounts(custom *structpb.Struct) ([]Mount, error) {
	raw := custom.GetFields()["codeRepositories"]
	if raw == nil {
		return nil, nil
	}
	list := raw.GetListValue()
	if list == nil {
		return nil, fmt.Errorf("codeRepositories must be an array")
	}
	mounts := make([]Mount, 0, len(list.Values))
	for _, item := range list.Values {
		fields := item.GetStructValue().GetFields()
		mount := Mount{
			ID:        strings.TrimSpace(fields["id"].GetStringValue()),
			RepoURL:   strings.TrimSpace(fields["repoUrl"].GetStringValue()),
			Branch:    strings.TrimSpace(fields["branch"].GetStringValue()),
			MountPath: strings.TrimSpace(fields["mountPath"].GetStringValue()),
			Token:     fields["token"].GetStringValue(),
		}
		if mount.ID == "" || mount.RepoURL == "" || mount.Branch == "" || mount.MountPath == "" {
			return nil, fmt.Errorf("codeRepositories entries require id, repoUrl, branch, and mountPath")
		}
		if !strings.HasPrefix(mount.MountPath, "/") {
			return nil, fmt.Errorf("codeRepositories mountPath must be absolute")
		}
		mounts = append(mounts, mount)
	}
	return mounts, nil
}

func SecretValue(mounts []Mount) ([]byte, error) {
	data, err := json.Marshal(mounts)
	if err != nil {
		return nil, fmt.Errorf("failed to encode code repositories: %w", err)
	}
	return data, nil
}

func EnvVar(secretName string) corev1.EnvVar {
	return corev1.EnvVar{
		Name: EnvName,
		ValueFrom: &corev1.EnvVarSource{
			SecretKeyRef: &corev1.SecretKeySelector{
				LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
				Key:                  SecretKey,
			},
		},
	}
}

func CommandWithDownload(command string) string {
	return downloadScript + "\n" + command
}

const downloadScript = `# download GitLab archive repositories
if [ -n "${AIONE_CODE_REPOSITORIES:-}" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      apt-get install -y --no-install-recommends python3 ca-certificates
    else
      echo "python3 is required to download code repositories" >&2
      exit 1
    fi
  fi
  python3 - <<'PY'
import io
import json
import os
import posixpath
import sys
import urllib.parse
import urllib.request
import zipfile

ARCHIVE_FILENAME = "archive.zip"

def log(message):
    print(message)
    sys.stdout.flush()

def parse_git_url(repo_url):
    parsed = urllib.parse.urlparse(repo_url)
    root = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return root, path

def safe_extract_archive(content, target_dir):
    os.makedirs(target_dir, exist_ok=True)
    root = os.path.abspath(target_dir)
    with zipfile.ZipFile(io.BytesIO(content), "r") as zip_ref:
        infos = zip_ref.infolist()
        names = [info.filename for info in infos]
        top_level = posixpath.commonpath(names) if names else ""
        for info in infos:
            relative = posixpath.relpath(info.filename, top_level) if top_level else info.filename
            if relative == ".":
                continue
            target_path = os.path.abspath(os.path.join(target_dir, *relative.split("/")))
            if os.path.commonpath([root, target_path]) != root:
                raise RuntimeError(f"unsafe archive path: {info.filename}")
            if info.is_dir():
                os.makedirs(target_path, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with zip_ref.open(info.filename) as source, open(target_path, "wb") as target:
                target.write(source.read())

def download(repo):
    repo_url = repo.get("repoUrl") or repo.get("id")
    branch = repo.get("branch") or "master"
    target_dir = repo.get("mountPath")
    token = repo.get("token") or ""
    if not repo_url or not target_dir:
        raise RuntimeError("repoUrl and mountPath are required")
    repo_root, project_path = parse_git_url(repo_url)
    encoded_project = urllib.parse.quote(project_path, safe="")
    query = urllib.parse.urlencode({"sha": branch})
    url = f"{repo_root}/api/v4/projects/{encoded_project}/repository/{ARCHIVE_FILENAME}?{query}"
    headers = {}
    if token:
        headers["Private-Token"] = token
    log(f"Downloading code repository {repo_url}@{branch} to {target_dir}")
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise RuntimeError(f"download failed with status {response.status}")
        safe_extract_archive(response.read(), target_dir)
    log(f"Downloaded code repository to {target_dir}")

for repo in json.loads(os.environ.get("AIONE_CODE_REPOSITORIES", "[]")):
    download(repo)
PY
fi`
