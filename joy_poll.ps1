Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct JOYCAPS {
        public ushort wMid;
        public ushort wPid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szPname;
        public uint wXmin;
        public uint wXmax;
        public uint wYmin;
        public uint wYmax;
        public uint wZmin;
        public uint wZmax;
        public uint wNumButtons;
        public uint wPeriodMin;
        public uint wPeriodMax;
        public uint wRmin;
        public uint wRmax;
        public uint wUmin;
        public uint wUmax;
        public uint wVmin;
        public uint wVmax;
        public uint wCaps;
        public uint wMaxAxes;
        public uint wNumAxes;
        public uint wMaxButtons;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szRegKey;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szOEMVxD;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOYINFOEX {
        public uint dwSize;
        public uint dwFlags;
        public uint dwXpos;
        public uint dwYpos;
        public uint dwZpos;
        public uint dwRpos;
        public uint dwUpos;
        public uint dwVpos;
        public uint dwButtons;
        public uint dwButtonNumber;
        public uint dwPOV;
        public uint dwReserved1;
        public uint dwReserved2;
    }

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern int joyGetDevCapsW(IntPtr uJoyID, ref JOYCAPS pjc, int cbjc);

    [DllImport("winmm.dll")]
    public static extern int joyGetPosEx(int uJoyID, ref JOYINFOEX pji);
}
"@

$dummyCaps = New-Object Win32+JOYCAPS
$capsSize = [System.Runtime.InteropServices.Marshal]::SizeOf($dummyCaps)

$dummyInfo = New-Object Win32+JOYINFOEX
$infoSize = [System.Runtime.InteropServices.Marshal]::SizeOf($dummyInfo)

# Cache of OEM names
$joyNames = @{}
$prevStates = @{}

function Get-JoystickName($id) {
    if ($joyNames.ContainsKey($id)) { return $joyNames[$id] }
    $caps = New-Object Win32+JOYCAPS
    $res = [Win32]::joyGetDevCapsW([IntPtr]$id, [ref]$caps, $capsSize)
    if ($res -eq 0) {
        $vid = $caps.wMid.ToString("X4")
        $prodId = $caps.wPid.ToString("X4")
        $vidpid = "VID_$vid&PID_$prodId"
        
        $oemName = ""
        $regPath = "HKCU:\System\CurrentControlSet\Control\MediaProperties\PrivateProperties\Joystick\OEM\$vidpid"
        if (Test-Path $regPath) {
            $oemName = (Get-ItemProperty $regPath -Name "OEMName" -ErrorAction SilentlyContinue).OEMName
        }
        if (-not $oemName) {
            $oemName = $caps.szPname
        }
        $joyNames[$id] = $oemName
        return $oemName
    }
    return $null
}

# Clear output buffering
$stdout = [System.Console]::OpenStandardOutput()

while ($true) {
    for ($i = 0; $i -lt 16; $i++) {
        $name = Get-JoystickName $i
        if (-not $name) {
            if ($prevStates.ContainsKey($i)) {
                $prevStates.Remove($i)
            }
            continue
        }
        
        $info = New-Object Win32+JOYINFOEX
        $info.dwSize = $infoSize
        $info.dwFlags = 255 # JOY_RETURNALL
        
        $res = [Win32]::joyGetPosEx($i, [ref]$info)
        if ($res -eq 0) {
            $buttons = $info.dwButtons
            if (-not $prevStates.ContainsKey($i)) {
                $prevStates[$i] = [uint32]0
            }
            $prevButtons = $prevStates[$i]
            
            if ($buttons -ne $prevButtons) {
                # Check each of the 32 buttons
                for ($b = 0; $b -lt 32; $b++) {
                    $mask = [uint32][Math]::Pow(2, $b)
                    $isDown = ($buttons -band $mask) -ne 0
                    $wasDown = ($prevButtons -band $mask) -ne 0
                    
                    if ($isDown -and -not $wasDown) {
                        # Pressed
                        $evt = @{ event="pressed"; joyId=$i; name=$name; button=$b }
                        Write-Output (ConvertTo-Json -Compress $evt)
                    }
                    elseif (-not $isDown -and $wasDown) {
                        # Released
                        $evt = @{ event="released"; joyId=$i; name=$name; button=$b }
                        Write-Output (ConvertTo-Json -Compress $evt)
                    }
                }
                $prevStates[$i] = $buttons
            }
        }
    }
    Start-Sleep -Milliseconds 40
}
