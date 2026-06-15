import base64
import json
import os
import requests
import sys
import zipfile

from dataclasses import dataclass
from minio import Minio
from urllib.parse import urlparse, quote


ARCHIVE_FILENAME = "archive.zip"


@dataclass
class GitData:
    repo_url: str
    target_dir: str
    access_token: str
    branch: str


@dataclass
class S3Data:
    endpoint: str
    access_key: str
    secret_key: str
    bucket_name: str
    bucket_path: str
    target_dir: str


@dataclass
class WorkflowInputs:
    codes: list[GitData]
    s3datas: list[S3Data]


def mlworkflow() -> str:
    flush_print("\n初始化...")
    # 环境变量中读出参数，Base64解码，转换
    env_params = os.getenv("AIONE_PARAMS")
    
    params = json.loads(base64.b64decode(env_params).decode('utf-8'))
    mltask(_inputs(params))

    flush_print("\n初始化完成.")


def mltask(task_datas: WorkflowInputs) -> str:
    # 拉代码
    for git_data in task_datas.codes:
        flush_print("\n代码库下载")
        _clone_git(data=git_data)

    # 拉对象存储-数据集
    for s3_data in task_datas.s3datas:
        flush_print("\n数据集下载")
        _pull_oss(s3_data)


def _inputs(params: any):
    git_datas = [GitData(
        repo_url=code.get("id"),
        target_dir=code.get("path"),
        access_token=code.get("token"),
        branch=code.get("branch") or "master",
        )
        for code in params.get("codes")
    ]
    s3_datas = [S3Data(
        endpoint=f"{ossdata.get("endPoint")}:{ossdata.get("port")}",
        access_key=ossdata.get("accessKey"),
        secret_key=ossdata.get("secretKey"),
        bucket_name=ossdata.get("bucket"),
        bucket_path=ossdata.get("bucketPath") or "",
        target_dir=ossdata.get("targetPath"),
        )
        for ossdata in params.get("ossDatas")
    ]
    inputs = WorkflowInputs(codes=git_datas, s3datas=s3_datas)
    return inputs


# 强制立即刷新标准输出
def flush_print(*args, **kwargs):
    print(*args, **kwargs)
    sys.stdout.flush()

# --------------------------- 拉代码 ---------------------------
def _clone_git(data: GitData) -> str:
    """ 拉代码 """
    headers = {
        'Private-Token': data.access_token
    }
    repo_root, project_path = _parse_git_url(data.repo_url)
    gitlab_rest_api_root = f"{repo_root}/api/v4/projects"
    # 代码库名称，做转义。如 serverless%2Faione
    project_path = quote(project_path, safe='')
    url = f'{gitlab_rest_api_root}/{project_path}/repository/{ARCHIVE_FILENAME}?sha={data.branch}'
    try:
        response = requests.get(url, headers=headers, )
        if response.status_code == 200:
            target_file = _save_archive_file(data.target_dir, response)
            flush_print(f"代码已成功下载并保存为 {target_file}")

            _unzip(data.target_dir)
            return f"拉代码到目录 {data.target_dir}"
        else:
            # token错误时，会返回404
            flush_print(f"下载失败，状态码: {response.status_code}")
            return f"下载失败，状态码 {response.status_code}"
    except Exception as e:
        flush_print(f"拉代码时发生异常: {e}")
        return f"拉代码时发生异常: {e}"


def _save_archive_file(target_dir: str, response: requests.Response) -> str:
    """保存代码到本地，并返回文件路径"""
    if target_dir.endswith('/'):
        target_dir = target_dir[:-1]

    # 清理目录
    flush_print(f"检查目录并清理/创建 {target_dir}")
    _clear_dir(target_dir)

    target_filepath = f"{target_dir}/{ARCHIVE_FILENAME}"
    flush_print(f"保存文件 {target_filepath}")
    with open(target_filepath, 'wb') as f:
        f.write(response.content)
    return target_filepath


def _clear_dir(directory: str) -> None:
    # 其实无用。因为目录是挂载目录，所以不需要清理也不需要创建
    os.makedirs(directory, exist_ok=True)


def _unzip(target_dir: str) -> None:
    archive_file_path = f"{target_dir}/{ARCHIVE_FILENAME}"

    with zipfile.ZipFile(archive_file_path, 'r') as zip_ref:
        # 获取ZIP文件中的所有文件信息
        all_files = zip_ref.infolist()

        # 获取第一个文件的路径片段数，用于识别顶层目录
        top_level_dir = os.path.commonpath(file.filename for file in all_files)

        # 如果存在顶层目录
        for file_info in all_files:
            # 获取相对路径（去掉顶层目录）
            relative_path = os.path.relpath(file_info.filename, top_level_dir)

            if relative_path != '.':
                # 定义解压目标路径（去掉顶层目录）
                target_path = os.path.join(target_dir, relative_path)

                # 如果是目录则忽略创建
                if file_info.is_dir():
                    os.makedirs(target_path, exist_ok=True)
                else:
                    # 确保目标目录存在
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)

                    # 提取文件到目标路径
                    with zip_ref.open(file_info.filename) as source, open(target_path, 'wb') as target:
                        target.write(source.read())

    os.remove(archive_file_path)
    flush_print(f'代码压缩文件已解压到: {target_dir}，并已删除压缩文件')


def _parse_git_url(repo_url: str) -> tuple[str, str]:
    """
    从GitLab URL中解析出根URL、项目ID。
    如 https://git.fzyun.io/serverless/aione.git ，得到 "https://git.fzyun.io"、"serverless/aione"
    """
    parsed_url = urlparse(repo_url)

    gitlab_root = f"{parsed_url.scheme}://{parsed_url.netloc}"

    # 提取路径部分并去掉前后的'/'
    path = parsed_url.path.strip('/')

    # 去掉.git后缀
    if path.endswith('.git'):
        path = path[:-4]

    return gitlab_root, path


# --------------------------- 拉对象存储 ---------------------------
def _pull_oss(data: S3Data) -> str:
    """ 拉对象存储-数据集 """

    client = Minio(
        endpoint=data.endpoint,
        access_key=data.access_key,
        secret_key=data.secret_key,
        secure=False  # 对于 HTTPS，设置为 True
    )
    try:
        # 确保本地目录存在
        if not os.path.exists(data.target_dir):
            os.makedirs(data.target_dir)

        result = _download_directory(client, data)
        flush_print(f"数据集已下载到: {data.target_dir}\n")
        return f"数据集已下载到: {data.target_dir} \n{result}"
    except Exception as e:
        flush_print(f"数据集下载异常：{e}\n")
        return f"数据集下载异常：{e}"


def _download_directory(minio_client: Minio, data: S3Data) -> str:
    result: list[str] = []

    flush_print(data)
    objects = minio_client.list_objects(data.bucket_name, prefix=data.bucket_path, recursive=True)
    for obj in objects:
        if obj.is_dir:
            continue
        obj_path = obj.object_name
        relative_path = obj_path[len(data.bucket_path)+1:] if data.bucket_path else obj_path

        output_file = os.path.join(data.target_dir, relative_path)
        if not os.path.exists(os.path.dirname(output_file)):
            os.makedirs(os.path.dirname(output_file))
        minio_client.fget_object(data.bucket_name, obj_path, output_file)
        flush_print(f"Downloaded: {obj_path},  Target: {output_file}")
        result.append(f"Downloaded: {obj_path},  Target: {output_file}")
    return "\n".join(result)


if __name__ == "__main__":
    mlworkflow()
