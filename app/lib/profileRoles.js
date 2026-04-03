const toText = (value) => {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
};

const toLowerText = (value) => toText(value).toLowerCase();

const MONITOR_VALUES = new Set(["monitor", "monitora"]);
const STUDENT_VALUES = new Set(["student", "estudiante", "alumno"]);

const getRoleCandidates = (profile) => {
  if (!profile || typeof profile !== "object") return [];
  return [
    profile.role,
    profile.accountType,
    profile.userType,
    profile.profileType,
    profile.type,
  ]
    .map(toLowerText)
    .filter(Boolean);
};

const hasStudentSignals = (profile) =>
  Boolean(
    toText(profile?.studentCode) ||
      toText(profile?.studentName) ||
      toText(profile?.stopAddress)
  );

export const isMonitorProfile = (profile) => {
  if (!profile || typeof profile !== "object") return false;

  const candidates = getRoleCandidates(profile);
  if (candidates.some((value) => MONITOR_VALUES.has(value))) return true;
  if (candidates.some((value) => STUDENT_VALUES.has(value))) return false;
  if (hasStudentSignals(profile)) return false;

  return Boolean(
    toText(profile?.route) && toText(profile?.institutionCode || profile?.institutionName)
  );
};

export const isStudentProfile = (profile) => {
  if (!profile || typeof profile !== "object") return false;

  const candidates = getRoleCandidates(profile);
  if (candidates.some((value) => MONITOR_VALUES.has(value))) return false;
  if (candidates.some((value) => STUDENT_VALUES.has(value))) return true;

  return hasStudentSignals(profile);
};
