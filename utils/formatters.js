const moment = require("moment");
const momentTimezone = require("moment-timezone");

const formatDate = (date) => {
  try {
    return momentTimezone(date).tz("Asia/Kolkata").format("DD MMM YYYY");
  } catch (err) {
    return "-";
  }
};

const formatTime = (createdAt) => {
  try {
    return momentTimezone(createdAt).tz("Asia/Kolkata").format("hh:mm A");
  } catch (err) {
    return "-";
  }
};

const timeAgo = (timestamp) => {
  const now = Date.now();
  const diffInSeconds = Math.floor((now - timestamp) / 1000);

  if (diffInSeconds < 60) return "now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d`;
  return new Date(timestamp * 1000).toLocaleDateString(); // Show full date if older than a week
};

const convertToUTC = (time12hr, startDate) => {
  // Parse the 12-hour time using a known format (e.g., "hh:mm A" for 12-hour format with AM/PM)
  const localTime = moment(time12hr, "hh:mm A");

  // Subtract one hour from the parsed time
  const adjustedTime = localTime.subtract(1, "hours");

  // Convert to UTC time (just the time, not the date yet)
  const utcTime = adjustedTime.utc();

  // Create a new Date object from the provided startDate
  const newDate = new Date(startDate);

  // Set the hours and minutes on newDate using the converted UTC time
  newDate.setUTCHours(utcTime.hours(), utcTime.minutes(), 0, 0);

  // Return the new date with updated time
  return newDate;
};

const convertISTToUTC = (startDate, time12hr) => {
  // Ensure startDate is a string in YYYY-MM-DD format
  const parsedDate =
    startDate instanceof Date
      ? moment(startDate).format("YYYY-MM-DD") // Convert Date object to string
      : moment(startDate, "DD/MM/YYYY").format("YYYY-MM-DD"); // Convert DD/MM/YYYY to YYYY-MM-DD

  // Parse the given date & time in IST
  const istDateTime = moment.tz(
    `${parsedDate} ${time12hr}`,
    "YYYY-MM-DD hh:mm A",
    "Asia/Kolkata"
  );

  if (!istDateTime.isValid()) {
    throw new Error(
      `Time conversion error: Invalid date/time format (${startDate}, ${time12hr})`
    );
  }

  // Convert to UTC and return
  return istDateTime.utc().toDate();
};

const convertStartDateToUTC = (date, time) => {
  // Combine date and time using 12-hour format

  const localDateTime = momentTimezone.tz(
    `${date} ${time}`,
    "YYYY-MM-DD hh:mm A",
    momentTimezone.tz.guess()
  );

  // Convert to UTC
  const orderStartDateInUTC = localDateTime.clone().utc();

  // Return the UTC time in desired format
  return orderStartDateInUTC.format();
};

const convertEndDateToUTC = (date, time) => {
  const localDateTime = momentTimezone.tz(
    `${date} ${time}`,
    "YYYY-MM-DD hh:mm A",
    momentTimezone.tz.guess()
  );

  // Convert to UTC
  const orderEndDateInUTC = localDateTime.clone().utc();

  // Return the UTC time in desired format
  return orderEndDateInUTC.format();
};

module.exports = {
  formatDate,
  formatTime,
  convertToUTC,
  convertStartDateToUTC,
  convertEndDateToUTC,
  convertISTToUTC,
  timeAgo,
};
