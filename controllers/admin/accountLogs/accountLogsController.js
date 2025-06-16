const moment = require("moment");
const path = require("path");
const fs = require("fs");
const csvWriter = require("csv-writer").createObjectCsvWriter;

const Agent = require("../../../models/Agent");
const Customer = require("../../../models/Customer");
const Merchant = require("../../../models/Merchant");
const AccountLogs = require("../../../models/AccountLogs");

const appError = require("../../../utils/appError");
const { formatDate, formatTime } = require("../../../utils/formatters");

const filterUserInAccountLogs = async (req, res, next) => {
  try {
    const { role, query, date } = req.query;

    const filterCriteria = {};

    if (role) {
      filterCriteria.role = role;
    }

    if (query) {
      filterCriteria.fullName = { $regex: query.trim(), $options: "i" };
    }

    if (date) {
      const formattedDay = moment.tz(date, "Asia/Kolkata");

      // Start and end of the previous day in IST
      const startDate = formattedDay.startOf("day").toDate();
      const endDate = formattedDay.endOf("day").toDate();

      filterCriteria.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const logs = await AccountLogs.find(filterCriteria).sort({ createdAt: -1 });

    const formattedResponse = logs.map((log) => ({
      logId: log._id,
      userId: log.userId,
      role: log.role,
      fullName: log.fullName,
      description: log.description,
      blockedDate: formatDate(log.createdAt),
      blockedTime: formatTime(log.createdAt),
      status: true,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const unBlockUserController = async (req, res, next) => {
  try {
    const userLog = await AccountLogs.findById(req.params.logId);

    if (!userLog) return next(appError("User not found in logs", 404));

    const userModels = {
      Merchant,
      Agent,
      Customer,
    };

    const userModel = userModels[userLog.role];
    if (!userModel) return next(appError("Invalid role specified", 400));

    const user = await userModel.findById(userLog.userId);
    if (!user) return next(appError(`${userLog.role} not found`, 404));

    const updateData =
      userLog.role === "Customer"
        ? {
            "customerDetails.isBlocked": false,
            "customerDetails.reasonForBlockingOrDeleting": null,
            "customerDetails.blockedDate": null,
          }
        : {
            isBlocked: false,
            reasonForBlockingOrDeleting: null,
            blockedDate: null,
          };

    await Promise.all([
      userModel.findByIdAndUpdate(userLog.userId, updateData),
      AccountLogs.findByIdAndDelete(req.params.logId),
    ]);

    res.status(200).json({ message: "User unblocked successfully" });
  } catch (err) {
    console.error("Error unblocking user:", err);
    next(appError(err.message, 500));
  }
};

const downloadUserCSVInAccountLogs = async (req, res, next) => {
  try {
    const { role, query, date } = req.query;

    const filterCriteria = {};

    if (role) {
      filterCriteria.role = role;
    }

    if (query) {
      filterCriteria.fullName = { $regex: query.trim(), $options: "i" };
    }

    if (date) {
      const formattedStartDate = new Date(date);
      formattedStartDate.setHours(0, 0, 0, 0);
      const formattedEndDate = new Date(date);
      formattedEndDate.setHours(23, 59, 59, 999);

      filterCriteria.createdAt = {
        $gte: formattedStartDate,
        $lte: formattedEndDate,
      };
    }

    const logs = await AccountLogs.find(filterCriteria).sort({ createdAt: -1 });

    const formattedResponse = logs.map((log) => ({
      userId: log.userId,
      role: log.role,
      fullName: log.fullName,
      description: log.description,
      blockedDate: formatDate(log.createdAt),
      blockedTime: formatTime(log.createdAt),
    }));

    const filePath = path.join(__dirname, "../../../Account_logs.csv");

    const csvHeaders = [
      { id: "userId", title: "User ID" },
      { id: "role", title: "Role" },
      { id: "fullName", title: "Full Name" },
      { id: "description", title: "Description" },
      { id: "blockedDate", title: "Blocked Date" },
      { id: "blockedTime", title: "Blocked Time" },
    ];

    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    await writer.writeRecords(formattedResponse);

    res.status(200).download(filePath, "Account_Log.csv", (err) => {
      if (err) {
        next(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("File deletion error:", unlinkErr);
          }
        });
      }
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  filterUserInAccountLogs,
  downloadUserCSVInAccountLogs,
  unBlockUserController,
};
