@echo off
setlocal
set DIR=%~dp0
if defined JAVA_HOME goto execute
where java >nul 2>nul
if %ERRORLEVEL% EQU 0 goto execute
echo JAVA_HOME is not set and java was not found on PATH. Install Java 21 or set JAVA_HOME. 1>&2
exit /b 1
:execute
if defined JAVA_HOME (
  "%JAVA_HOME%\bin\java.exe" -classpath "%DIR%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
) else (
  java -classpath "%DIR%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
)
exit /b %ERRORLEVEL%
