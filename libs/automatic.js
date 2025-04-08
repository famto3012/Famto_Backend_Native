const mongoose = require("mongoose");
const Agent = require("../models/Agent");
const AgentAppCustomization = require("../models/AgentAppCustomization");
const Merchant = require("../models/Merchant");
const fs = require("fs");
const path = require("path");

const automaticStatusOfflineForAgent = async () => {
  const nowUTC = new Date();
  const nowIST = new Date(
    nowUTC.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  // Fetch all free and approved agents at once
  const agents = await Agent.find({ isApproved: "Approved", status: "Free" });

  if (!agents.length) return;

  // Extract all workTiming IDs for batch processing
  const workTimingIds = agents.flatMap(
    (agent) => agent.workStructure?.workTimings || []
  );

  if (!workTimingIds.length) return;

  // Fetch all work timings in **one query** instead of multiple
  const workTimingsData = await AgentAppCustomization.aggregate([
    { $unwind: "$workingTime" },
    {
      $match: {
        "workingTime._id": {
          $in: workTimingIds.map((id) =>
            mongoose.Types.ObjectId.createFromHexString(id)
          ),
        },
      },
    },
    {
      $project: {
        _id: "$workingTime._id",
        startTime: "$workingTime.startTime",
        endTime: "$workingTime.endTime",
      },
    },
  ]);

  // Map work timings for fast lookup
  const workTimingsMap = new Map(
    workTimingsData.map((workTime) => [workTime._id.toString(), workTime])
  );

  // Prepare bulk update operations
  const bulkOps = [];

  for (const agent of agents) {
    const workTimings = agent.workStructure.workTimings
      .map((id) => workTimingsMap.get(id.toString()))
      .filter(Boolean);

    const isWithinWorkingHours = workTimings.some(({ startTime, endTime }) => {
      const [startHour, startMinute] = startTime.split(":").map(Number);
      const [endHour, endMinute] = endTime.split(":").map(Number);

      const start = new Date(nowIST);
      const end = new Date(nowIST);

      start.setHours(startHour, startMinute, 0, 0);
      end.setHours(endHour, endMinute, 0, 0);

      return nowIST >= start && nowIST <= end;
    });

    if (!isWithinWorkingHours && agent.status !== "Busy") {
      bulkOps.push({
        updateOne: {
          filter: { _id: agent._id },
          update: {
            $set: { status: "Inactive" },
            $push: {
              activityLog: {
                date: new Date(),
                description: "Agent automatically went OFFLINE",
              },
            },
          },
        },
      });
    }
  }

  // Execute bulk update if needed
  if (bulkOps.length) {
    await Agent.bulkWrite(bulkOps);
  }
};

const automaticStatusToggleForMerchant = async () => {
  const currentDay = new Date()
    .toLocaleString("en-us", { timeZone: "Asia/Kolkata", weekday: "long" })
    .toLowerCase();
  const currentTime = new Date().toLocaleTimeString("en-US", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });

  const formattedTime = currentTime.startsWith("24")
    ? `00${currentTime.slice(2)}`
    : currentTime;

  // Fetch only relevant merchants
  const merchants = await Merchant.find({
    isApproved: "Approved",
    isBlocked: false,
    statusManualToggle: false,
  }).select(
    "_id merchantDetail.availability.type merchantDetail.availability.specificDays"
  );

  let merchantsToOpen = [];
  let merchantsToClose = [];
  //console.log("Merchant number", merchants.length)

  merchants.forEach((merchant) => {
    const availabilityType = merchant?.merchantDetail?.availability?.type;
    const todayAvailability =
      merchant?.merchantDetail?.availability?.specificDays[currentDay];

    if (availabilityType === "Full-time") {
      merchantsToOpen.push(merchant._id);
      return; // Skip further checks
    }

    if (todayAvailability?.openAllDay) {
      merchantsToOpen.push(merchant._id);
      return; // Skip further checks
    }

    if (todayAvailability?.closedAllDay) {
      merchantsToClose.push(merchant._id);
      return; // Skip further checks
    }

    if (todayAvailability?.specificTime) {
      let { startTime, endTime } = todayAvailability;

      // Handle past-midnight case
      if (
        (startTime <= endTime &&
          formattedTime >= startTime &&
          formattedTime <= endTime) ||
        (startTime > endTime &&
          (formattedTime >= startTime || formattedTime <= endTime))
      ) {
        merchantsToOpen.push(merchant._id);
      } else {
        merchantsToClose.push(merchant._id);
      }
    }
  });

  // Bulk update merchants who should be OPEN
  if (merchantsToOpen.length > 0) {
    await Merchant.updateMany(
      { _id: { $in: merchantsToOpen } },
      {
        $set: {
          status: true,
          openedToday: true,
          statusManualToggle: false,
        },
      }
    );
  }

  // Bulk update merchants who should be CLOSED
  if (merchantsToClose.length > 0) {
    await Merchant.updateMany(
      { _id: { $in: merchantsToClose } },
      {
        $set: {
          status: false,
          openedToday: false,
          statusManualToggle: false,
        },
      }
    );
  }
};

const deleteOldLogs = () => {
  const logsDir = path.join(__dirname, "../middlewares/logs");
  const retentionDays = 3;
  const now = Date.now();

  fs.readdir(logsDir, (err, files) => {
    if (err) return console.error("Failed to read logs directory:", err);

    files.forEach((file) => {
      if (file.startsWith("error-") && file.endsWith(".log")) {
        const filePath = path.join(logsDir, file);

        fs.stat(filePath, (err, stats) => {
          if (err) return console.error("Failed to get file stats:", err);

          const ageInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
          if (ageInDays > retentionDays) {
            fs.unlink(filePath, (err) => {
              if (err) console.error("Error deleting log file:", file, err);
              else console.log("🧹 Deleted old log file:", file);
            });
          }
        });
      }
    });
  });
};

module.exports = {
  automaticStatusOfflineForAgent,
  automaticStatusToggleForMerchant,
  deleteOldLogs,
};
