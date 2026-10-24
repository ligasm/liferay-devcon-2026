#!/bin/sh
# S0 — Baseline: the setenv.sh that ships in the Liferay Tomcat bundle (2025.Qx),
# reproduced here for reference. Nothing tuned. JDK 21 defaults G1.
#
# The bundle's file looks like this (CATALINA_OPTS split across lines for readability):
CATALINA_OPTS="$CATALINA_OPTS -Dfile.encoding=UTF-8 -Djava.locale.providers=JRE,COMPAT,CLDR -Djava.net.preferIPv4Stack=true -Duser.timezone=GMT -Xms2560m -Xmx2560m -XX:MaxNewSize=1536m -XX:MaxMetaspaceSize=768m -XX:MetaspaceSize=768m -XX:NewSize=1536m -XX:SurvivorRatio=7"
# UNVERIFIED — check learn.liferay.com: the exact bundle values vary by quarterly
# release; take the real line from tomcat/bin/setenv.sh of YOUR bundle as S0.
