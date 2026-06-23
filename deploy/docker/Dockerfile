FROM docker.fzyun.io/founder/aione.flyteinteractive:v1.3.0

USER root
ARG CODE_SERVER_VERSION=4.19.0

# 设置软件源
ARG UBUNTU_MIRROR=mirrors.fzyun.io
RUN echo "deb https://${UBUNTU_MIRROR}/ubuntu/ noble main restricted universe multiverse" > /etc/apt/sources.list && \
    echo "deb https://${UBUNTU_MIRROR}/ubuntu/ noble-updates main restricted universe multiverse" >> /etc/apt/sources.list && \
    echo "deb https://${UBUNTU_MIRROR}/ubuntu/ noble-backports main restricted universe multiverse" >> /etc/apt/sources.list && \
    echo "deb https://${UBUNTU_MIRROR}/ubuntu/ noble-security main restricted universe multiverse" >> /etc/apt/sources.list

# 设置 pip 镜像源
ENV PIP_INDEX_URL=https://pypi.fzyun.io/simple

# 安装依赖并配置sudo
RUN apt-get update && \
    apt-get install -y sudo git curl ca-certificates && \
    echo "flytekit ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    # 设置默认shell为bash，设置IDE深色主题
    chsh -s /bin/bash && \
    mkdir -p /home/flytekit/.local/share/code-server/User && \
    echo '{\
        "workbench.colorTheme": "Default Dark+",\
        "terminal.integrated.defaultProfile.linux": "bash",\
        "terminal.integrated.profiles.linux": {\
            "bash": {\
                "path": "/bin/bash",\
                "icon": "terminal-bash"\
            }\
        }\
    }' > /home/flytekit/.local/share/code-server/User/settings.json && \
    chown -R flytekit:flytekit /home/flytekit && \
    # 安装 kubernetes
    pip install --no-cache-dir kubernetes -i ${PIP_INDEX_URL}

RUN curl -fL \
      -o /opt/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz \
      https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz && \
    tar -xzf /opt/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz -C /opt && \
    ln -sf /opt/code-server-${CODE_SERVER_VERSION}-linux-amd64/bin/code-server /usr/local/bin/code-server

USER root
