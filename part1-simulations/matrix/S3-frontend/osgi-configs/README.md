# OSGi configuration files for S3 (shape only)

Liferay reads `*.config` files from `$LIFERAY_HOME/osgi/configs/`. The file name is
the configuration PID; keys are the configuration's field names.

## Documents & Media cache control

The documented way is the UI (System/Instance Settings → Documents and Media →
Cache Control: *Cache Control Policy* Private|Public, *Max Age* seconds, *MIME
Type Exclusions*). The doc page does not publish the PID.

`com.liferay.document.library.internal.configuration.DLCacheControlConfiguration.config`
is the file name you will see in an export from Control Panel → System Settings →
Export; **UNVERIFIED — check learn.liferay.com / export the config from your
instance and copy the exact PID and key names** before using the sample here.

## Adaptive Media

Image resolutions are stored per company as configuration entries created from
the UI (Control Panel → Configuration → Adaptive Media). No public `.config`
format is documented for creating resolutions; use the UI and then
*Adapt Remaining Images* for content uploaded before the resolution existed.
