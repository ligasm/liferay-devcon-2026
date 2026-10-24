#!/bin/sh
# S1 — Hygiene: correct JDK 21 flags. Nothing exotic — the win here is removing
# flags that are wrong for JDK 21 (CMS/ParNew are gone since JDK 15; a JVM given
# -XX:+UseConcMarkSweepGC will refuse to start) and making the heap explicit.
#
# Sources: learn.liferay.com → "JVM Configuration" (file.encoding, user.timezone,
# log4j2 lookups, --add-opens for JDK 17/21) and "Tuning Your JVM".
# GC choice is discussed in S2-jvm-caches/setenv.sh (G1 vs Generational ZGC).

# --- mandatory for Liferay (learn.liferay.com/w/dxp/.../reference/jvm-configuration)
LIFERAY_OPTS="-Dfile.encoding=UTF-8 -Duser.timezone=GMT -Djava.net.preferIPv4Stack=true \
 -Djava.locale.providers=JRE,COMPAT,CLDR -Dlog4j2.formatMsgNoLookups=true \
 --add-opens=java.base/java.lang=ALL-UNNAMED \
 --add-opens=java.base/java.lang.reflect=ALL-UNNAMED \
 --add-opens=jdk.zipfs/jdk.nio.zipfs=ALL-UNNAMED"

# --- heap: fixed size (no resize pauses); 4 GB per node is the Deployment
#     Checklist figure, the Tuning page says 2560m. Never exceed ~31 GB (compressed oops).
HEAP_OPTS="-Xms4096m -Xmx4096m -XX:MetaspaceSize=768m -XX:MaxMetaspaceSize=768m"

# --- GC: G1 is the JDK 21 default. State it explicitly so nobody "helpfully"
#     re-adds CMS flags. GC logging to a rolling file is cheap and essential.
GC_OPTS="-XX:+UseG1GC -XX:MaxGCPauseMillis=200 \
 -Xlog:gc*,gc+age=trace,safepoint:file=$CATALINA_BASE/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50m"

# --- diagnostics you want on in production (near-zero overhead)
DIAG_OPTS="-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=$CATALINA_BASE/logs \
 -XX:+ExitOnOutOfMemoryError"

CATALINA_OPTS="$CATALINA_OPTS $LIFERAY_OPTS $HEAP_OPTS $GC_OPTS $DIAG_OPTS"

# REMOVED on purpose (do not re-add on JDK 21):
#   -XX:+UseParNewGC -XX:+UseConcMarkSweepGC -XX:+CMSParallelRemarkEnabled
#   -XX:+CMSCompactWhenClearAllSoftRefs -XX:CMSInitiatingOccupancyFraction=85
#   -XX:+CMSScavengeBeforeRemark -XX:ParallelGCThreads=16
#   -XX:NewSize/-XX:MaxNewSize/-XX:SurvivorRatio (G1 sizes generations itself;
#   fixing NewSize disables G1's adaptive sizing — UNVERIFIED for your workload,
#   measure before keeping the bundle's values)
