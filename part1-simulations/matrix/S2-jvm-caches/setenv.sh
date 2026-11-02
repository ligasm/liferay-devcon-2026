#!/bin/sh
# S2 — JVM: two alternatives. Pick ONE by setting GC=g1 (default) or GC=zgc.
#
# G1 (JDK 21 default): predictable, well understood, right for 4–16 GB heaps.
# Generational ZGC (JDK 21+, -XX:+UseZGC -XX:+ZGenerational): sub-millisecond
# pauses per JEP 439. In our lab (6 GB heap, about 600 MB live) it gave no gain over G1:
# see results/RUNG-RESULTS.md. Large heaps are untested. Liferay's Go Live Checklist
# 2026.Q1 says "G1 should be the default choice for Liferay DXP". So: measure. This stage is where you run
# the same k6 mix against both and put the p99 side by side.
#
# NOTE: on JDK 23+ ZGC is generational by default and -XX:+ZGenerational is
# deprecated; DXP 2025.Qx runs on JDK 21 where the flag is required.

GC="${GC:-g1}"

LIFERAY_OPTS="-Dfile.encoding=UTF-8 -Duser.timezone=GMT -Djava.net.preferIPv4Stack=true \
 -Djava.locale.providers=JRE,COMPAT,CLDR -Dlog4j2.formatMsgNoLookups=true \
 --add-opens=java.base/java.lang=ALL-UNNAMED \
 --add-opens=java.base/java.lang.reflect=ALL-UNNAMED \
 --add-opens=jdk.zipfs/jdk.nio.zipfs=ALL-UNNAMED"

# Bigger heap than S1 because S2 grows the entity/finder caches (heap counts entries!)
HEAP_OPTS="-Xms6g -Xmx6g -XX:MetaspaceSize=768m -XX:MaxMetaspaceSize=768m -XX:+AlwaysPreTouch"

case "$GC" in
  zgc)
    GC_OPTS="-XX:+UseZGC -XX:+ZGenerational -XX:SoftMaxHeapSize=5g"
    ;;
  *)
    GC_OPTS="-XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:G1HeapRegionSize=4m -XX:InitiatingHeapOccupancyPercent=45"
    # G1HeapRegionSize / IHOP: UNVERIFIED for Liferay specifically — sensible JDK 21
    # starting points; drop them to let G1 self-tune if you cannot measure.
    ;;
esac

GC_LOG="-Xlog:gc*,gc+age=trace,safepoint:file=$CATALINA_BASE/logs/gc-$GC.log:time,uptime,level,tags:filecount=5,filesize=50m"

DIAG_OPTS="-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=$CATALINA_BASE/logs -XX:+ExitOnOutOfMemoryError \
 -Dcom.sun.management.jmxremote -Dcom.sun.management.jmxremote.port=8099 \
 -Dcom.sun.management.jmxremote.authenticate=false -Dcom.sun.management.jmxremote.ssl=false"
# JMX is how you SEE the caches: org.ehcache:type=CacheStatistics,* (hit ratio,
# evictions) and com.zaxxer.hikari:type=Pool (*) (ActiveConnections, ThreadsAwaitingConnection).
# Bind JMX to localhost / secure it before exposing on a real network.

# JGroups (Cluster Link over TCP + JDBC_PING, see jgroups/jdbc_ping.xml)
CLUSTER_OPTS="-Djgroups.bind_addr=${JGROUPS_BIND_ADDR:-127.0.0.1} -Djgroups.tcp.port=7800"

CATALINA_OPTS="$CATALINA_OPTS $LIFERAY_OPTS $HEAP_OPTS $GC_OPTS $GC_LOG $DIAG_OPTS $CLUSTER_OPTS"
