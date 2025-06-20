const Customer = require("../models/Customer");
const CustomerNotificationLogs = require("../models/CustomerNotificationLog");
const Merchant = require("../models/Merchant");
const MerchantNotificationLogs = require("../models/MerchantNotificationLog");
const SubscriptionLog = require("../models/SubscriptionLog");
const { sendNotification } = require("../socket/socket");
const moment = require("moment-timezone");

// const deleteExpiredSubscriptionPlans = async () => {
//   const now = new Date();
//   const today = new Date(now.setHours(0, 0, 0, 0));
//   const threeDaysFromNow = new Date(today);
//   threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

//   try {
//     // Fetch subscription logs where the endDate is within the next 3 days or has already passed
//     const subscriptionLogs = await SubscriptionLog.find({
//       endDate: { $lte: threeDaysFromNow },
//     }).lean(); // Use lean to fetch raw data for faster performance

//     // Fetch merchant and customer notifications for today in bulk
//     const startOfDay = new Date(now.setHours(0, 0, 0, 0));
//     const endOfDay = new Date(now.setHours(23, 59, 59, 999));

//     const existingMerchantNotifications = await MerchantNotificationLogs.find({
//       createdAt: { $gte: startOfDay, $lt: endOfDay },
//     }).lean();

//     const existingCustomerNotifications = await CustomerNotificationLogs.find({
//       createdAt: { $gte: startOfDay, $lt: endOfDay },
//     }).lean();

//     const bulkUpdates = [];
//     // const bulkDeletions = [];

//     for (const subscriptionLog of subscriptionLogs) {
//       const threeDaysBeforeEndDate = new Date(subscriptionLog.endDate);
//       threeDaysBeforeEndDate.setDate(threeDaysBeforeEndDate.getDate() - 3);

//       const daysUntilExpiration = Math.ceil(
//         (subscriptionLog.endDate - now) / (1000 * 60 * 60 * 24)
//       );
//       const description = `Your plan will expire in ${daysUntilExpiration} days. Recharge now to avoid disconnection.`;

//       // Check if notification has already been sent
//       let notificationExists = false;
//       if (subscriptionLog.typeOfUser === "Merchant") {
//         notificationExists = existingMerchantNotifications.some(
//           (log) =>
//             log.merchantId === subscriptionLog.userId &&
//             log.description === description
//         );
//       } else {
//         notificationExists = existingCustomerNotifications.some(
//           (log) =>
//             log.customerId === subscriptionLog.userId &&
//             log.description === description
//         );
//       }

//       if (
//         now >= threeDaysBeforeEndDate &&
//         now < subscriptionLog.endDate &&
//         !notificationExists
//       ) {
//         // console.log(
//         //   `Sending notification to ${subscriptionLog.userId} for plan expiration.`
//         // );
//         const data = {
//           socket: {
//             title: `Subscription plan`,
//             description,
//           },
//           fcm: {
//             title: `Subscription plan`,
//             body: description,
//             image: "",
//             ...(subscriptionLog.typeOfUser === "Customer"
//               ? { customerId: subscriptionLog.userId }
//               : { merchantId: subscriptionLog.userId }),
//           },
//         };

//         const eventName = "subscriptionPlanEnd";
//         sendNotification(
//           subscriptionLog.userId,
//           eventName,
//           data,
//           subscriptionLog.typeOfUser
//         );
//         sendNotification(
//           process.env.ADMIN_ID,
//           eventName,
//           data,
//           subscriptionLog.typeOfUser
//         );
//       }

//       // If the plan has expired, proceed with deletion
//       if (now >= subscriptionLog.endDate) {
//         // console.log(
//         //   `Subscription for ${subscriptionLog.userId} has expired. Proceeding with removal.`
//         // );

//         // Prepare for bulk update or deletion
//         if (subscriptionLog.typeOfUser === "Merchant") {
//           bulkUpdates.push(
//             Merchant.updateOne(
//               { "merchantDetail.pricing.modelId": subscriptionLog._id },
//               {
//                 $pull: {
//                   "merchantDetail.pricing": { modelId: subscriptionLog._id },
//                 },
//               }
//             )
//           );

//           const data = {
//             socket: {
//               title: `Subscription plan`,
//               description: `Your plan has expired.`,
//             },
//             fcm: {
//               title: `Subscription plan`,
//               body: `Your plan has expired.`,
//               image: "",
//               merchantId: subscriptionLog.userId,
//             },
//           };

//           const eventName = "subscriptionPlanEnd";
//           sendNotification(
//             subscriptionLog.userId,
//             eventName,
//             data,
//             subscriptionLog.typeOfUser
//           );
//           sendNotification(
//             process.env.ADMIN_ID,
//             eventName,
//             data,
//             subscriptionLog.typeOfUser
//           );
//         } else {
//           bulkUpdates.push(
//             Customer.updateOne(
//               { "customerDetails.pricing": subscriptionLog._id },
//               { $pull: { "customerDetails.pricing": subscriptionLog._id } }
//             )
//           );

//           const data = {
//             socket: {
//               title: `Subscription plan`,
//               description: `Your plan has expired.`,
//             },
//             fcm: {
//               title: `Subscription plan`,
//               body: `Your plan has expired.`,
//               image: "",
//               customerId: subscriptionLog.userId,
//             },
//           };

//           const eventName = "subscriptionPlanEnd";
//           sendNotification(
//             subscriptionLog.userId,
//             eventName,
//             data,
//             subscriptionLog.typeOfUser
//           );
//           sendNotification(
//             process.env.ADMIN_ID,
//             eventName,
//             data,
//             subscriptionLog.typeOfUser
//           );
//         }

//         // Add to bulk deletion list
//         // bulkDeletions.push(
//         //   SubscriptionLog.deleteOne({ _id: subscriptionLog._id })
//         // );
//       }
//     }

//     // Perform all bulk updates and deletions in parallel
//     // await Promise.all([...bulkUpdates, ...bulkDeletions]);
//     await Promise.all([...bulkUpdates]);
//     // console.log("Bulk operations completed successfully.");
//   } catch (err) {
//     console.error("Error processing expired subscription plans:", err);
//   }
// };

const deleteExpiredSubscriptionPlans = async () => {
  const timezone = "Asia/Kolkata";

  const now = moment().tz(timezone);
  const today = now.clone().startOf("day");
  const threeDaysFromNow = today.clone().add(3, "days");

  try {
    // Fetch subscription logs which are expiring in next 3 days or already expired
    const subscriptionLogs = await SubscriptionLog.find({
      endDate: { $lte: threeDaysFromNow.toDate() },
    }).lean();

    if (subscriptionLogs.length === 0) return; // Nothing to process

    // Get today's existing notifications to avoid duplicates
    const startOfDay = today.clone();
    const endOfDay = today.clone().endOf("day");

    const [existingMerchantNotifications, existingCustomerNotifications] =
      await Promise.all([
        MerchantNotificationLogs.find({
          createdAt: { $gte: startOfDay.toDate(), $lte: endOfDay.toDate() },
        }).lean(),
        CustomerNotificationLogs.find({
          createdAt: { $gte: startOfDay.toDate(), $lte: endOfDay.toDate() },
        }).lean(),
      ]);

    const bulkUpdates = [];

    for (const subscriptionLog of subscriptionLogs) {
      const endDate = moment(subscriptionLog.endDate).tz(timezone);
      const threeDaysBeforeEndDate = endDate.clone().subtract(3, "days");

      const daysUntilExpiration = endDate.diff(now, "days");
      const description = `Your plan will expire in ${daysUntilExpiration} days. Recharge now to avoid disconnection.`;

      // Check if notification already sent for near-expiry reminder
      let notificationExists = false;

      if (subscriptionLog.typeOfUser === "Merchant") {
        notificationExists = existingMerchantNotifications.some(
          (log) =>
            log.merchantId === subscriptionLog.userId &&
            log.description === description
        );
      } else {
        notificationExists = existingCustomerNotifications.some(
          (log) =>
            log.customerId === subscriptionLog.userId &&
            log.description === description
        );
      }

      // Send near-expiry notification (3 days before)
      if (
        now.isSameOrAfter(threeDaysBeforeEndDate) &&
        now.isBefore(endDate) &&
        !notificationExists
      ) {
        const data = {
          socket: { title: `Subscription plan`, description },
          fcm: {
            title: `Subscription plan`,
            body: description,
            image: "",
            ...(subscriptionLog.typeOfUser === "Customer"
              ? { customerId: subscriptionLog.userId }
              : { merchantId: subscriptionLog.userId }),
          },
        };

        const eventName = "subscriptionPlanEnd";
        sendNotification(
          subscriptionLog.userId,
          eventName,
          data,
          subscriptionLog.typeOfUser
        );
        sendNotification(
          process.env.ADMIN_ID,
          eventName,
          data,
          subscriptionLog.typeOfUser
        );
      }

      // Handle expired subscriptions
      if (now.isSameOrAfter(endDate)) {
        // Check if user has any other active subscriptions
        const activeSubscriptionExists = await SubscriptionLog.exists({
          userId: subscriptionLog.userId,
          typeOfUser: subscriptionLog.typeOfUser,
          endDate: { $gt: now.toDate() },
          _id: { $ne: subscriptionLog._id },
        });

        if (activeSubscriptionExists) continue;

        if (subscriptionLog.typeOfUser === "Merchant") {
          bulkUpdates.push(
            Merchant.updateOne(
              { "merchantDetail.pricing.modelId": subscriptionLog._id },
              {
                $pull: {
                  "merchantDetail.pricing": { modelId: subscriptionLog._id },
                },
              }
            )
          );

          const data = {
            socket: {
              title: `Subscription plan`,
              description: `Your plan has expired.`,
            },
            fcm: {
              title: `Subscription plan`,
              body: `Your plan has expired.`,
              image: "",
              merchantId: subscriptionLog.userId,
            },
          };

          const eventName = "subscriptionPlanEnd";
          sendNotification(
            subscriptionLog.userId,
            eventName,
            data,
            subscriptionLog.typeOfUser
          );
          sendNotification(
            process.env.ADMIN_ID,
            eventName,
            data,
            subscriptionLog.typeOfUser
          );
        } else {
          bulkUpdates.push(
            Customer.updateOne(
              { "customerDetails.pricing": subscriptionLog._id },
              { $pull: { "customerDetails.pricing": subscriptionLog._id } }
            )
          );

          const data = {
            socket: {
              title: `Subscription plan`,
              description: `Your plan has expired.`,
            },
            fcm: {
              title: `Subscription plan`,
              body: `Your plan has expired.`,
              image: "",
              customerId: subscriptionLog.userId,
            },
          };

          const eventName = "subscriptionPlanEnd";
          sendNotification(
            subscriptionLog.userId,
            eventName,
            data,
            subscriptionLog.typeOfUser
          );
          sendNotification(
            process.env.ADMIN_ID,
            eventName,
            data,
            subscriptionLog.typeOfUser
          );
        }
      }
    }

    // Execute all updates in parallel
    if (bulkUpdates.length > 0) {
      await Promise.all(bulkUpdates);
    }
  } catch (err) {
    console.error("Error processing expired subscription plans:", err);
  }
};

module.exports = { deleteExpiredSubscriptionPlans };
