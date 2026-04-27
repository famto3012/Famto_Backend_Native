const mongoose = require("mongoose");

const dbConnect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      maxPoolSize: 50,
      minPoolSize: 10,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 30000,
    });
    console.log("Connected to db");
  } catch (err) {
    console.log("Error while connecting to db");
    process.exit(1);
  }
};

dbConnect();
