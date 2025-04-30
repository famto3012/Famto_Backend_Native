const Manager = require("../models/Manager");
const ManagerRoles = require("../models/ManagerRoles");
const { sendNotification, sendSocketData } = require("../socket/socket");

const sendSocketDataAndNotification = async ({
  rolesToNotify,
  eventName,
  userIds,
  notificationData,
  socketData,
}) => {
  try {
    for (const role of rolesToNotify) {
      let roleId;

      if (role === "admin") {
        roleId = userIds?.admin;
      } else if (role === "merchant") {
        roleId = userIds?.merchant;
      } else if (role === "driver") {
        roleId = userIds?.agent;
      } else if (role === "customer") {
        roleId = userIds?.customer;
      } else {
        const roleValue = await ManagerRoles.findOne({ roleName: role });

        if (roleValue) {
          // Find all managers with this role instead of just one
          const managers = await Manager.find({ role: roleValue._id });

          // Send notifications to each manager
          for (const manager of managers) {
            const roleId = manager._id;
            if (roleId) {
              await sendNotification(
                roleId,
                eventName,
                notificationData,
                role.charAt(0).toUpperCase() + role.slice(1)
              );

              // Send socket data to each manager
              sendSocketData(roleId, eventName, socketData);
            }
          }
        }
      }

      if (roleId) {
        await sendNotification(
          roleId,
          eventName,
          notificationData,
          role.charAt(0).toUpperCase() + role.slice(1)
        );

        sendSocketData(roleId, eventName, socketData);
      }
    }
  } catch (err) {
    console.log("Error in sendSocketDataAndNotification", err);
  }
};

module.exports = {
  sendSocketDataAndNotification,
};
