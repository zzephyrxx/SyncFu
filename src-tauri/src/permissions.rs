use serde::Serialize;

#[derive(Serialize)]
pub struct WindowsFirewall {
    private_network: bool,
    syncfu_rule: bool,
}

pub fn open_settings() -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("/usr/bin/open");
        command.arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocalNetwork");
        command
    };
    #[cfg(windows)]
    let mut command = {
        let mut command = std::process::Command::new(system32()?.join("control.exe"));
        command.args([
            "/name",
            "Microsoft.WindowsFirewall",
            "/page",
            "pageConfigureApps",
        ]);
        command
    };
    #[cfg(any(windows, target_os = "macos"))]
    anyhow::ensure!(command.status()?.success(), "无法打开系统权限设置");
    #[cfg(not(any(windows, target_os = "macos")))]
    anyhow::bail!("请在系统设置中检查局域网访问权限");
    #[cfg(any(windows, target_os = "macos"))]
    Ok(())
}

#[cfg(windows)]
const RULE: &str = "SyncFu-Private-LAN";

#[cfg(windows)]
fn system32() -> anyhow::Result<std::path::PathBuf> {
    use anyhow::Context;
    Ok(
        std::path::PathBuf::from(
            std::env::var_os("SystemRoot").context("找不到 Windows 系统目录")?,
        )
        .join("System32"),
    )
}

#[cfg(windows)]
fn powershell(script: &str) -> anyhow::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;

    Ok(
        std::process::Command::new(system32()?.join("WindowsPowerShell/v1.0/powershell.exe"))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()?,
    )
}

#[cfg(windows)]
fn encode_wide(units: impl Iterator<Item = u16>) -> String {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    STANDARD.encode(units.flat_map(u16::to_le_bytes).collect::<Vec<_>>())
}

#[cfg(windows)]
fn encoded_program() -> anyhow::Result<String> {
    use std::os::windows::ffi::OsStrExt;
    Ok(encode_wide(
        std::env::current_exe()?.as_os_str().encode_wide(),
    ))
}

#[cfg(windows)]
pub fn firewall_status(port: u16) -> anyhow::Result<WindowsFirewall> {
    let program = encoded_program()?;
    let output = powershell(&format!(
        r#"
        $ErrorActionPreference = 'Stop'
        $program = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('{program}'))
        $private = @(Get-NetConnectionProfile | Where-Object {{ $_.NetworkCategory -eq 'Private' }}).Count -gt 0
        $rules = Get-NetFirewallRule -PolicyStore ActiveStore -Name '{RULE}' -ErrorAction SilentlyContinue
        $matching = @($rules | Where-Object {{
            $_ -and $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and
            $_.Action -eq 'Allow' -and $_.Profile -eq 'Private' -and
            ($_ | Get-NetFirewallApplicationFilter).Program -eq $program -and
            ($_ | Get-NetFirewallPortFilter).Protocol -eq 'TCP' -and
            ($_ | Get-NetFirewallPortFilter).LocalPort -eq '{port}' -and
            ($_ | Get-NetFirewallAddressFilter).RemoteAddress -contains 'LocalSubnet'
        }}).Count -gt 0
        [Console]::WriteLine(('{{0}},{{1}}' -f $private, $matching))
    "#
    ))?;
    anyhow::ensure!(output.status.success(), "无法读取 Windows 防火墙状态");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let (private, rule) = stdout
        .trim()
        .split_once(',')
        .ok_or_else(|| anyhow::anyhow!("Windows 防火墙返回了无法识别的状态"))?;
    Ok(WindowsFirewall {
        private_network: private == "True",
        syncfu_rule: rule == "True",
    })
}

#[cfg(windows)]
pub fn allow_private_lan(port: u16) -> anyhow::Result<()> {
    let program = encoded_program()?;
    let elevated = format!(
        r#"
        $ErrorActionPreference = 'Stop'
        try {{
            $program = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('{program}'))
            $rule = @{{Name='{RULE}'; Enabled='True'; Direction='Inbound'; Action='Allow'; Profile='Private'; Program=$program; Protocol='TCP'; LocalPort='{port}'; RemoteAddress='LocalSubnet'; EdgeTraversalPolicy='Block'}}
            if (Get-NetFirewallRule -Name '{RULE}' -ErrorAction SilentlyContinue) {{
                Set-NetFirewallRule @rule | Out-Null
            }} else {{
                New-NetFirewallRule @rule -DisplayName 'SyncFu (Private LAN)' | Out-Null
            }}
            exit 0
        }} catch {{ exit 1 }}
    "#
    );
    let encoded = encode_wide(elevated.encode_utf16());
    let output = powershell(&format!(
        r#"
        $ErrorActionPreference = 'Stop'
        $process = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','{encoded}'
        exit $process.ExitCode
    "#
    ))?;
    anyhow::ensure!(
        output.status.success(),
        "未能添加防火墙规则。请在管理员提示中选择允许，或打开防火墙设置手动授权"
    );
    Ok(())
}
