FROM catthehacker/ubuntu:act-latest
# Emulate the self-hosted runner image: a runner user (uid 1001) that owns the
# workspace, and a preinstalled pinned yamllint (CI's --setup printed no
# "Installing yamllint..." line, so the image already ships one).
RUN useradd -m -u 1001 github-runner \
 && pip3 install --break-system-packages yamllint==1.35.1 \
 && yamllint --version
# The act image trusts every repo system-wide; a real self-hosted runner does
# not, and #12647 needs git's ownership check live.
RUN git config --system --unset-all safe.directory && ! git config --system --get-all safe.directory
