const csvWriter = require("csv-writer").createObjectCsvWriter;
const mongoose = require("mongoose");
const csvParser = require("csv-parser");
const { Readable } = require("stream");
const axios = require("axios");
const path = require("path");
const fs = require("fs").promises;

const AccountLogs = require("../../../models/AccountLogs");
const Customer = require("../../../models/Customer");
const Order = require("../../../models/Order");
const CustomerTransaction = require("../../../models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("../../../models/CustomerWalletTransaction");

const appError = require("../../../utils/appError");
const { formatDate, formatTime } = require("../../../utils/formatters");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../../utils/imageOperation");

// TODO: Remove after panel V2
const getAllCustomersController = async (req, res, next) => {
  try {
    // Get page and limit from query parameters with default values
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    // Fetch customers with pagination
    const allCustomers = await Customer.find({
      "customerDetails.isBlocked": false,
    })
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails averageRating"
      )
      .skip(skip)
      .limit(limit);

    // Count total documents
    const totalDocuments = await Customer.countDocuments({
      "customerDetails.isBlocked": false,
    });

    // Format customers data
    const formattedCustomers = allCustomers?.map((customer) => {
      return {
        _id: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        phoneNumber: customer.phoneNumber || "-",
        lastPlatformUsed: customer.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        rating: customer?.customerDetails?.averageRating || 0,
      };
    });

    // Calculate total pages
    const totalPages = Math.ceil(totalDocuments / limit);

    res.status(200).json({
      message: "All customers",
      data: formattedCustomers || [],
      totalDocuments,
      totalPages,
      currentPage: page,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// TODO: Remove after panel V2
const searchCustomerByNameController = async (req, res, next) => {
  try {
    let { query, page = 1, limit = 25 } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({
        message: "Search query cannot be empty",
      });
    }

    // Convert to integers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Calculate the number of documents to skip
    const skip = (page - 1) * limit;

    const searchCriteria = {
      fullName: { $regex: query.trim(), $options: "i" },
      "customerDetails.isBlocked": false,
    };

    const searchResults = await Customer.find(searchCriteria)
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
      )
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true });

    // Count total documents
    const totalDocuments = (await Customer.countDocuments(searchCriteria)) || 1;

    // Calculate averageRating and format registrationDate for each customer
    const formattedCustomers = searchResults.map((customer) => {
      const homeAddress = customer?.customerDetails?.homeAddress || {};
      const workAddress = customer?.customerDetails?.workAddress || {};
      const otherAddress = customer?.customerDetails?.otherAddress || [];

      return {
        _id: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        phoneNumber: customer.phoneNumber,
        lastPlatformUsed: customer.lastPlatformUsed,
        registrationDate: formatDate(customer.createdAt),
        averageRating: customer.customerDetails?.averageRating || 0,
        address: [
          { type: "home", homeAddress },
          { type: "work", workAddress },
          { type: "other", otherAddress },
        ],
      };
    });

    let pagination = {
      totalDocuments: totalDocuments || 0,
      totalPages: Math.ceil(totalDocuments / limit),
      currentPage: page || 1,
      pageSize: limit,
      hasNextPage: page < Math.ceil(totalDocuments / limit),
      hasPrevPage: page > 1,
    };

    res.status(200).json({
      message: "Searched customers",
      data: formattedCustomers,
      pagination,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// TODO: Remove after panel V2
const filterCustomerByGeofenceController = async (req, res, next) => {
  try {
    let { filter, page = 1, limit = 25 } = req.query;

    // Convert to integers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Calculate the number of documents to skip
    const skip = (page - 1) * limit;

    // Base query
    let query = { "customerDetails.isBlocked": false };

    // If filter is not "all", filter by geofenceId
    if (filter && filter.trim().toLowerCase() !== "all") {
      const geofenceObjectId = mongoose.Types.ObjectId.createFromHexString(
        filter.trim()
      );
      query = { "customerDetails.geofenceId": geofenceObjectId };
    }

    // Find customers based on the query
    const filteredResults = await Customer.find(query)
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
      )
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true });

    // Count total documents based on the query
    const totalDocuments = (await Customer.countDocuments(query)) || 1;

    // Format the customers
    const formattedCustomers = filteredResults.map((customer) => {
      return {
        _id: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        phoneNumber: customer.phoneNumber,
        lastPlatformUsed: customer?.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        averageRating: customer.customerDetails?.averageRating || 0,
      };
    });

    // Pagination info
    const pagination = {
      totalDocuments: totalDocuments || 0,
      totalPages: Math.ceil(totalDocuments / limit),
      currentPage: page || 1,
      pageSize: limit,
      hasNextPage: page < Math.ceil(totalDocuments / limit),
      hasPrevPage: page > 1,
    };

    res.status(200).json({
      message: "Filtered customers",
      data: formattedCustomers,
      pagination,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const fetchAllCustomersByAdminController = async (req, res, next) => {
  try {
    let { geofence, query, page = 1, limit = 50 } = req.query;

    // Convert to integers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Calculate the number of documents to skip
    const skip = (page - 1) * limit;

    // Base query
    let matchCriteria = { "customerDetails.isBlocked": false };

    // If filter is not "all", filter by geofenceId
    if (geofence && geofence.trim().toLowerCase() !== "all") {
      matchCriteria["customerDetails.geofenceId"] =
        mongoose.Types.ObjectId.createFromHexString(geofence.trim());
    }

    if (query && query.trim() !== "") {
      matchCriteria.$or = [
        {
          fullName: {
            $regex: query.trim(),
            $options: "i",
          },
        },
        {
          phoneNumber: {
            $regex: query.trim(),
            $options: "i",
          },
        },
      ];
    }

    const [result, totalCount] = await Promise.all([
      Customer.find(matchCriteria)
        .select(
          "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
        )
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true }),
      Customer.countDocuments(matchCriteria),
    ]);

    // Format the customers
    const formattedCustomers = result.map((customer) => {
      return {
        customerId: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        phoneNumber: customer.phoneNumber,
        lastPlatformUsed: customer?.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        averageRating: customer.customerDetails?.averageRating || 0,
      };
    });

    res.status(200).json({
      total: totalCount,
      data: formattedCustomers,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const searchCustomerByNameForOrderController = async (req, res, next) => {
  try {
    let { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({
        message: "Search query cannot be empty",
      });
    }

    const searchResults = await Customer.find({
      $or: [
        { fullName: { $regex: query.trim(), $options: "i" } },
        { phoneNumber: { $regex: query.trim(), $options: "i" } },
      ],
      "customerDetails.isBlocked": false,
    })
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
      )
      .lean({ virtuals: true });

    // Calculate averageRating and format registrationDate for each customer
    const formattedCustomers = searchResults.map((customer) => {
      const homeAddress = customer?.customerDetails?.homeAddress || {};
      const workAddress = customer?.customerDetails?.workAddress || {};
      const otherAddress = customer?.customerDetails?.otherAddress || [];

      // ? INFO: Changed _id to customerId
      return {
        customerId: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        phoneNumber: customer.phoneNumber,
        address: [
          { type: "home", homeAddress },
          { type: "work", workAddress },
          { type: "other", otherAddress },
        ],
      };
    });

    res.status(200).json({ data: formattedCustomers });
  } catch (err) {
    next(appError(err.message));
  }
};

const getSingleCustomerController = async (req, res, next) => {
  try {
    const { customerId } = req.params;

    const customerFound = await Customer.findById(customerId)
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails walletTransactionDetail"
      )
      .lean({ virtuals: true });

    if (!customerFound) {
      return next(appError("Customer not found", 404));
    }

    const [orders, transactions] = await Promise.all([
      Order.find({ customerId })
        .populate({
          path: "merchantId",
          select: "merchantDetail",
        })
        .sort({ createdAt: -1 })
        .limit(50),
      CustomerWalletTransaction.find({ customerId })
        .sort({ date: -1 })
        .limit(50),
    ]);

    const formattedCustomerOrders = orders?.map((order) => {
      const merchantDetail = order?.merchantId?.merchantDetail;
      const deliveryTimeMinutes = merchantDetail
        ? parseInt(merchantDetail?.deliveryTime, 10)
        : 0;
      const orderDeliveryTime = new Date(order.createdAt);
      orderDeliveryTime.setMinutes(
        orderDeliveryTime.getMinutes() + deliveryTimeMinutes
      );
      return {
        orderId: order._id,
        orderStatus: order.status,
        merchantName: order?.merchantId?.merchantDetail?.merchantName || "-",
        deliveryMode: order?.orderDetail?.deliveryMode,
        orderTime: `${formatDate(order.createdAt)} | ${formatTime(
          order.createdAt
        )}`,
        deliveryTime: `${formatDate(order.createdAt)} | ${formatTime(
          orderDeliveryTime
        )}`,
        paymentMethod: order.paymentMode,
        deliveryOption: order.orderDetail.deliveryOption,
        amount: order?.billDetail?.grandTotal,
        paymentStatus: order.paymentStatus,
      };
    });

    const formattedCustomerTransactions = transactions?.map((transaction) => {
      return {
        closingBalance: transaction.closingBalance || 0,
        transactionAmount: `${transaction.transactionAmount} ${
          transaction.type === "Debit" ? "Dr" : "Cr"
        }`,
        transactionId: transaction.transactionId || "-",
        orderId: transaction.orderId || "-",
        date:
          `${formatDate(transaction.date)} | ${formatTime(transaction.date)}` ||
          "-",
      };
    });

    const formattedCustomer = {
      _id: customerFound._id,
      fullName: customerFound.fullName || "-",
      email: customerFound.email || "-",
      phoneNumber: customerFound.phoneNumber,
      referralCode: customerFound.customerDetails.referralCode || "",
      customerImageURL: customerFound?.customerDetails?.customerImageURL || "",
      lastPlatformUsed: customerFound.lastPlatformUsed,
      location: customerFound.customerDetails.location || [],
      isBlocked: customerFound?.customerDetails?.isBlocked || false,
      registrationDate: formatDate(customerFound.createdAt),
      walletBalance: customerFound?.customerDetails?.walletBalance,
      homeAddress: customerFound?.customerDetails?.homeAddress ?? null,
      workAddress: customerFound?.customerDetails?.workAddress ?? null,
      otherAddress: customerFound?.customerDetails?.otherAddress || [],
      walletDetails: formattedCustomerTransactions || [],
      orderDetails: formattedCustomerOrders || [],
    };

    res.status(200).json({
      message: "Customer details",
      data: formattedCustomer,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const blockCustomerController = async (req, res, next) => {
  const { reason } = req.body;

  try {
    const customerFound = await Customer.findById(req.params.customerId);

    if (!customerFound) return next(appError("Customer not found", 404));

    if (customerFound.isBlocked)
      return next(appError("Customer is already blocked", 400));

    customerFound.customerDetails.isBlocked = true;
    customerFound.customerDetails.reasonForBlockingOrDeleting = reason;
    customerFound.customerDetails.blockedDate = new Date();

    await Promise.all([
      customerFound.save(),
      AccountLogs.create({
        userId: customerFound._id,
        fullName: customerFound.fullName,
        role: customerFound.role,
        description: reason,
      }),
    ]);

    res.status(200).json({ message: "Customer blocked successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

const editCustomerDetailsController = async (req, res, next) => {
  const {
    fullName,
    email,
    phoneNumber,
    homeAddress,
    workAddress,
    otherAddress,
  } = req.body;

  try {
    const customer = await Customer.findById(req.params.customerId);

    if (!customer) {
      return next(appError("Customer not found", 404));
    }

    await Customer.findByIdAndUpdate(
      req.params.customerId,
      {
        $set: {
          fullName,
          email,
          phoneNumber,
          "customerDetails.homeAddress": homeAddress,
          "customerDetails.workAddress": workAddress,
          "customerDetails.otherAddress": otherAddress,
          "customerDetails.customerImageURL":
            customer.customerDetails.customerImageURL,
        },
      },
      { new: true }
    );

    res.status(200).json({ message: "Customer updated successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

const getAllRatingsAndReviewsByAgentController = async (req, res, next) => {
  try {
    const { customerId } = req.params;

    // Step 1: Find the customer and populate ratings and agent details
    const customerFound = await Customer.findById(customerId).populate({
      path: "customerDetails.ratingsByAgents",
      populate: {
        path: "agentId",
        model: "Agent",
        select: "fullName _id",
      },
    });

    // Step 2: Check if the customer exists
    if (!customerFound) {
      return next(appError("Customer not found", 404));
    }

    // Step 3: Retrieve and reverse ratings, if they exist
    const ratingsOfCustomer =
      customerFound.customerDetails?.ratingsByAgents?.reverse() || [];

    // Step 4: Map ratings to extract review, rating, and agent information (with safety checks)
    const ratings = ratingsOfCustomer
      ?.map((rating) => {
        if (rating.agentId) {
          // Check if agentId exists
          return {
            review: rating.review || null,
            rating: rating.rating || null,
            agentId: {
              id: rating.agentId._id || null,
              fullName: rating.agentId.fullName || null,
            },
          };
        }
        return null; // Return null if there's no agentId
      })
      .filter(Boolean); // Filter out any null values

    // Step 5: Send response
    res.status(200).json({
      message: "Ratings of customer by agent",
      data: ratings,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const addMoneyToWalletController = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const { customerId } = req.params;

    if (isNaN(parseFloat(amount))) {
      return next(appError("Invalid amount provided", 400));
    }

    const customerFound = await Customer.findById(customerId);

    if (!customerFound) return next(appError("Customer not found", 404));

    // Ensure walletBalance is a number
    const currentBalance =
      parseFloat(customerFound.customerDetails.walletBalance) || 0;
    const amountToAdd = parseFloat(amount);

    let walletTransaction = {
      customerId,
      closingBalance: customerFound?.customerDetails?.walletBalance || 0,
      transactionAmount: amountToAdd,
      date: new Date(),
      type: "Credit",
    };

    customerFound.customerDetails.walletBalance = currentBalance + amountToAdd;

    await Promise.all([
      customerFound.save(),
      CustomerTransaction.create({
        customerId,
        madeOn: new Date(),
        transactionType: `Credited by ${req.userRole} (${req.userName} - ${req.userAuth})`,
        transactionAmount: amountToAdd,
        type: "Credit",
      }),
      CustomerWalletTransaction.create(walletTransaction),
    ]);

    res.status(200).json({
      success: true,
      message: `${amount} Rs is added to customer's wallet`,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const deductMoneyFromWalletCOntroller = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const { customerId } = req.params;

    if (isNaN(parseFloat(amount))) {
      return next(appError("Invalid amount provided", 400));
    }

    const customerFound = await Customer.findById(customerId);

    if (!customerFound) return next(appError("Customer not found", 404));

    let walletTransaction = {
      customerId,
      closingBalance: customerFound?.customerDetails?.walletBalance || 0,
      transactionAmount: parseFloat(amount),
      date: new Date(),
      type: "Debit",
    };

    let customerTransaction = {
      customerId,
      madeOn: new Date(),
      transactionType: `Debited by ${req.userRole} (${req.userName} - ${req.userAuth})`,
      transactionAmount: amount,
      type: "Debit",
    };

    customerFound.customerDetails.walletBalance -= parseFloat(amount);

    await Promise.all([
      customerFound.save(),
      CustomerTransaction.create(customerTransaction),
      CustomerWalletTransaction.create(walletTransaction),
    ]);

    res.status(200).json({
      success: true,
      message: `${amount} Rs is deducted from customer's wallet`,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const addCustomerFromCSVController = async (req, res, next) => {
  try {
    if (!req.file) return next(appError("CSV file is required", 400));

    // Upload the CSV file to Firebase and get the download URL
    const fileUrl = await uploadToFirebase(req.file, "csv-uploads");
    console.log("File uploaded to Firebase, file URL:", fileUrl); // Log the file URL

    const customers = [];

    // Download the CSV data from Firebase Storage
    const response = await axios.get(fileUrl);
    console.log("response", response);
    const csvData = response.data;
    console.log("CSV Data received:", csvData); // Log the received CSV data

    // Create a readable stream from the CSV data
    const stream = Readable.from(csvData);

    // Parse the CSV data
    stream
      .pipe(csvParser())
      .on("data", (row) => {
        console.log("Parsed row:", row); // Log each row to ensure proper parsing
        const isRowEmpty = Object.values(row).every(
          (value) => value.trim() === ""
        );

        if (!isRowEmpty) {
          const customer = {
            fullName: row["Full Name"]?.trim(),
            email: row["Email"]?.toLowerCase().trim(),
            phoneNumber: row["Phone Number"]?.trim(),
          };

          // Validate required fields
          if (!customer.email && !customer.phoneNumber) {
            return next(appError("Either email or phoneNumber is required."));
          }

          customers.push(customer);
        }
      })
      .on("end", async () => {
        console.log("Finished parsing CSV data. Customers:", customers); // Log the final customers array

        try {
          const customerPromise = customers.map(async (customerData) => {
            // Check if the customer already exists
            const existingCustomer = await Customer.findOne({
              $or: [
                { email: customerData.email },
                { phoneNumber: customerData.phoneNumber },
              ],
            });

            console.log("Existing customer check:", existingCustomer); // Log if customer exists

            if (existingCustomer) {
              // Prepare the update object
              const updateData = {};

              // Update only the provided fields
              if (customerData.fullName)
                updateData.fullName = customerData.fullName;
              if (customerData.email) updateData.email = customerData.email;
              if (customerData.phoneNumber)
                updateData.phoneNumber = customerData.phoneNumber;

              console.log("Updating customer:", existingCustomer._id); // Log the update operation
              await Customer.findByIdAndUpdate(
                existingCustomer._id,
                { $set: updateData },
                { new: true }
              );
            } else {
              console.log("Creating new customer:", customerData); // Log the creation operation
              await Customer.create({
                ...customerData,
                "customerDetails.isBlocked": false,
              });
            }
          });

          // Wait for all customer processing promises to finish
          await Promise.all(customerPromise);

          // Send success response
          res.status(200).json({
            message: "Customers added successfully.",
          });
        } catch (err) {
          console.error("Error during customer processing:", err); // Log any error during processing
          next(appError(err.message));
        } finally {
          // Ensure file is deleted from Firebase
          console.log("Deleting file from Firebase:", fileUrl); // Log before deletion
          await deleteFromFirebase(fileUrl);
        }
      })
      .on("error", (error) => {
        console.error("CSV Parsing Error:", error); // Log any error during CSV parsing
        next(appError(error.message));
      });
  } catch (err) {
    console.error("Error in addCustomerFromCSVController:", err); // Log any error in the main try block
    next(appError(err.message));
  }
};

const downloadCustomerSampleCSVController = async (req, res, next) => {
  try {
    // Define the path to your sample CSV file
    const filePath = path.join(__dirname, "../../../Customer_CSV.csv");

    // Define the headers and data for the CSV
    const csvHeaders = [
      { id: "fullName", title: "Full Name" },
      { id: "email", title: "Email" },
      { id: "phoneNumber", title: "Phone Number" },
    ];

    const csvData = [
      {
        fullName: "John Doe",
        email: "john.doe@example.com",
        phoneNumber: "1234567890",
      },
      {
        fullName: "Jane Smith",
        email: "jane.smith@example.com",
        phoneNumber: "9876543210",
      },
    ];

    // Create a new CSV writer
    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    // Write the data to the CSV file
    await writer.writeRecords(csvData);

    // Send the CSV file as a response for download
    res.download(filePath, "Customer_CSV.csv", (err) => {
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
  } catch (error) {
    res.status(500).send("Error processing the CSV file");
  }
};

const downloadCustomerCSVController = async (req, res, next) => {
  try {
    const { geofenceId, name } = req.query; // Added `name` filter for consistency
    const role = req.userRole;
    const userAuth = req.userAuth;

    // Build the query filter
    let filter = { "customerDetails.isBlocked": false };

    if (role === "Merchant") {
      const customerIds = await Order.aggregate([
        { $match: { merchantId: userAuth } },
        { $group: { _id: "$customerId" } },
      ]);

      const uniqueCustomerIds = customerIds.map((id) => id._id);

      filter._id = { $in: uniqueCustomerIds };

      if (geofenceId && geofenceId.toLowerCase() !== "all") {
        filter["customerDetails.geofenceId"] =
          mongoose.Types.ObjectId.createFromHexString(geofenceId);
      }
    } else if (geofenceId && geofenceId.toLowerCase() !== "all") {
      filter["customerDetails.geofenceId"] =
        mongoose.Types.ObjectId.createFromHexString(geofenceId);
    }

    if (name) {
      filter.$or = [
        { fullName: { $regex: name, $options: "i" } },
        { email: { $regex: name, $options: "i" } },
      ];
    }

    // Fetch customer data
    const allCustomers = await Customer.find(filter)
      .populate("customerDetails.geofenceId", "name")
      .sort({ createdAt: -1 })
      .lean();

    // Format the response
    const formattedResponse = allCustomers.map((customer) => ({
      customerId: customer._id || "",
      customerName: customer.fullName || "",
      customerEmail: customer.email || "",
      customerPhoneNumber: customer.phoneNumber || "",
      lastPlatformUsed: customer.lastPlatformUsed || "",
      geofence: customer?.customerDetails?.geofenceId?.name || "",
      referralCode: customer?.customerDetails?.referralCode || "",
      homeAddress: customer.customerDetails?.homeAddress
        ? `${customer.customerDetails.homeAddress.fullName}, ${customer.customerDetails.homeAddress.flat}, ${customer.customerDetails.homeAddress.area}, ${customer.customerDetails.homeAddress.landmark}`
        : "",
      workAddress: customer.customerDetails?.workAddress
        ? `${customer.customerDetails.workAddress.fullName}, ${customer.customerDetails.workAddress.flat}, ${customer.customerDetails.workAddress.area}, ${customer.customerDetails.workAddress.landmark}`
        : "",
      loyaltyPointEarnedToday:
        customer.customerDetails?.loyaltyPointEarnedToday || "",
      totalLoyaltyPointEarned:
        customer.customerDetails?.totalLoyaltyPointEarned || "",
    }));

    // Define file path and headers
    const filePath = path.join(__dirname, "../../../Customer_CSV.csv");
    const csvHeaders = [
      { id: "customerId", title: "Customer ID" },
      { id: "customerName", title: "Customer Name" },
      { id: "customerEmail", title: "Customer Email" },
      { id: "customerPhoneNumber", title: "Phone Number" },
      { id: "lastPlatformUsed", title: "Last Platform Used" },
      { id: "geofence", title: "Geofence" },
      { id: "referralCode", title: "Referral Code" },
      { id: "homeAddress", title: "Home Address" },
      { id: "workAddress", title: "Work Address" },
      { id: "loyaltyPointEarnedToday", title: "Loyalty Points Earned Today" },
      { id: "totalLoyaltyPointEarned", title: "Total Loyalty Points Earned" },
    ];

    console.log("Headers:", csvHeaders);

    // Write to CSV
    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    await writer.writeRecords(formattedResponse);
    console.log("CSV file written successfully at", filePath);

    // Send the CSV file
    res.status(200).download(filePath, "Customer_Data.csv", (err) => {
      if (err) {
        console.error("Download Error:", err);
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
    console.error("Error in downloadCustomerCSVController:", err);
    next(appError(err.message));
  }
};

// ---------------------------------
// For Merchant
// ---------------------------------

// TODO: Remove After panel V2
const getCustomersOfMerchant = async (req, res, next) => {
  try {
    let { page = 1, limit = 25 } = req.query;
    const merchantId = req.userAuth;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const skip = (page - 1) * limit;

    // Fetch all orders of the merchant
    const ordersOfMerchant = await Order.find({ merchantId }).select(
      "customerId"
    );

    // Extract unique customer IDs
    const uniqueCustomerIds = [
      ...new Set(ordersOfMerchant.map((order) => order.customerId.toString())),
    ];

    // Fetch customer names for the unique customer IDs
    const customers = await Customer.find({
      _id: { $in: uniqueCustomerIds },
    })
      .select(
        "fullName phoneNumber email lastPlatformUsed createdAt averageRating"
      )
      .skip(skip)
      .limit(limit);

    // Count total documents
    const totalDocuments = await Customer.countDocuments({
      _id: { $in: uniqueCustomerIds },
    });

    const formattedResponse = customers?.map((customer) => {
      return {
        _id: customer._id,
        fullName: customer?.fullName || "-",
        phoneNumber: customer?.phoneNumber || "-",
        email: customer?.email || "-",
        lastPlatformUsed: customer.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        rating: Math.floor(customer?.averageRating) || 0,
      };
    });

    const totalPages = Math.ceil(totalDocuments / limit);

    res.status(200).json({
      message: "Customers of merchant",
      data: formattedResponse,
      totalDocuments,
      totalPages,
      currentPage: page,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// TODO: Remove After panel V2
const searchCustomerByNameForMerchantController = async (req, res, next) => {
  try {
    const merchantId = req.userAuth;

    let { query, page = 1, limit = 25 } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({
        message: "Search query cannot be empty",
      });
    }

    // Convert to integers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Calculate the number of documents to skip
    const skip = (page - 1) * limit;

    // Find orders placed with this merchant to get customer IDs
    const ordersOfMerchant = await Order.find({ merchantId }).select(
      "customerId"
    );

    // Extract unique customer IDs from the orders
    const uniqueCustomerIds = [
      ...new Set(ordersOfMerchant.map((order) => order.customerId.toString())),
    ];

    // Find customers by name who belong to this merchant
    const searchResults = await Customer.find({
      _id: { $in: uniqueCustomerIds },
      fullName: { $regex: query.trim(), $options: "i" },
    })
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
      )
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true });

    // Count total documents for pagination (only for this merchant)
    const totalDocuments = await Customer.countDocuments({
      _id: { $in: uniqueCustomerIds },
      fullName: { $regex: query.trim(), $options: "i" },
    });

    // Format customers with necessary fields
    const formattedCustomers = searchResults.map((customer) => {
      const homeAddress = customer?.customerDetails?.homeAddress || {};
      const workAddress = customer?.customerDetails?.workAddress || {};
      const otherAddress = customer?.customerDetails?.otherAddress || [];

      return {
        _id: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        customerImageURL: customer?.customerDetails?.customerImageURL || null,
        phoneNumber: customer.phoneNumber,
        lastPlatformUsed: customer.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        averageRating: customer.customerDetails?.averageRating || 0,
        address: [
          { type: "home", homeAddress },
          { type: "work", workAddress },
          { type: "other", otherAddress },
        ],
      };
    });

    let pagination = {
      totalDocuments: totalDocuments || 0,
      totalPages: Math.ceil(totalDocuments / limit),
      currentPage: page || 1,
      pageSize: limit,
      hasNextPage: page < Math.ceil(totalDocuments / limit),
      hasPrevPage: page > 1,
    };

    res.status(200).json({
      message: "Searched customers",
      data: formattedCustomers,
      pagination,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// TODO: Remove After panel V2
const filterCustomerByGeofenceForMerchantController = async (
  req,
  res,
  next
) => {
  try {
    let { filter, page = 1, limit = 25 } = req.query;

    // Convert to integers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Calculate the number of documents to skip
    const skip = (page - 1) * limit;

    const merchantId = req.userAuth;

    // Fetch all orders of the merchant
    const ordersOfMerchant = await Order.find({ merchantId }).select(
      "customerId"
    );

    // Extract unique customer IDs
    const uniqueCustomerIds = [
      ...new Set(ordersOfMerchant.map((order) => order.customerId.toString())),
    ];

    // Base query
    let query = {
      _id: { $in: uniqueCustomerIds },
    };

    // If filter is not "all", filter by geofenceId
    if (filter && filter.trim().toLowerCase() !== "all") {
      const geofenceObjectId = new mongoose.Types.ObjectId(filter.trim());
      query["customerDetails.geofenceId"] = geofenceObjectId;
    }

    // Find customers based on the query
    const filteredResults = await Customer.find(query)
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
      )
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true });

    // Count total documents based on the query
    const totalDocuments = filteredResults?.length || 1;

    // Format the customers
    const formattedCustomers = filteredResults.map((customer) => {
      return {
        _id: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        phoneNumber: customer.phoneNumber,
        lastPlatformUsed: customer?.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        averageRating: customer.customerDetails?.averageRating || 0,
      };
    });

    // Pagination info
    const pagination = {
      totalDocuments: totalDocuments || 0,
      totalPages: Math.ceil(totalDocuments / limit),
      currentPage: page || 1,
      pageSize: limit,
      hasNextPage: page < Math.ceil(totalDocuments / limit),
      hasPrevPage: page > 1,
    };

    res.status(200).json({
      message: "Searched customers",
      data: formattedCustomers,
      pagination,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const fetchCustomersOfMerchantController = async (req, res, next) => {
  try {
    let { geofence, query, page = 1, limit = 50 } = req.query;
    const merchantId = req.userAuth;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const skip = (page - 1) * limit;

    // Fetch all orders of the merchant
    const ordersOfMerchant = await Order.find({ merchantId }).select(
      "customerId"
    );

    // Extract unique customer IDs
    const uniqueCustomerIds = [
      ...new Set(ordersOfMerchant.map((order) => order.customerId.toString())),
    ];

    const matchCriteria = {
      _id: { $in: uniqueCustomerIds },
    };

    if (geofence && geofence.trim().toLowerCase() !== "all") {
      matchCriteria["customerDetails.geofenceId"] =
        mongoose.Types.ObjectId.createFromHexString(geofence.trim());
    }

    if (query && query.trim !== "") {
      matchCriteria.fullName = {
        $regex: query.trim(),
        $options: "i",
      };
    }

    const [result, totalCount] = await Promise.all([
      Customer.find(matchCriteria)
        .select(
          "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
        )
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true }),
      Customer.countDocuments(matchCriteria),
    ]);

    // Format the customers
    const formattedCustomers = result.map((customer) => {
      return {
        customerId: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        phoneNumber: customer.phoneNumber,
        lastPlatformUsed: customer?.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        averageRating: customer.customerDetails?.averageRating || 0,
      };
    });

    res.status(200).json({
      total: totalCount,
      data: formattedCustomers,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const searchCustomerByNameForMerchantToOrderController = async (
  req,
  res,
  next
) => {
  try {
    const merchantId = req.userAuth;

    let { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({
        message: "Search query cannot be empty",
      });
    }

    // Find orders placed with this merchant to get customer IDs
    const ordersOfMerchant = await Order.find({ merchantId }).select(
      "customerId"
    );

    // Extract unique customer IDs from the orders
    const uniqueCustomerIds = [
      ...new Set(ordersOfMerchant.map((order) => order.customerId.toString())),
    ];

    // Find customers by name who belong to this merchant
    const searchResults = await Customer.find({
      _id: { $in: uniqueCustomerIds },
      fullName: { $regex: query.trim(), $options: "i" },
    })
      .select(
        "fullName email phoneNumber lastPlatformUsed createdAt customerDetails"
      )
      .lean({ virtuals: true });

    // Format customers with necessary fields
    const formattedCustomers = searchResults.map((customer) => {
      const homeAddress = customer?.customerDetails?.homeAddress || {};
      const workAddress = customer?.customerDetails?.workAddress || {};
      const otherAddress = customer?.customerDetails?.otherAddress || [];

      return {
        _id: customer._id,
        fullName: customer.fullName || "-",
        email: customer.email || "-",
        customerImageURL: customer?.customerDetails?.customerImageURL || null,
        phoneNumber: customer.phoneNumber,
        lastPlatformUsed: customer.lastPlatformUsed || "-",
        registrationDate: formatDate(customer.createdAt),
        averageRating: customer.customerDetails?.averageRating || 0,
        address: [
          { type: "home", homeAddress },
          { type: "work", workAddress },
          { type: "other", otherAddress },
        ],
      };
    });

    res.status(200).json({
      message: "Searched customers",
      data: formattedCustomers,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getAllCustomersController,
  searchCustomerByNameController,
  searchCustomerByNameForOrderController,
  searchCustomerByNameForMerchantController,
  searchCustomerByNameForMerchantToOrderController,
  filterCustomerByGeofenceController,
  filterCustomerByGeofenceForMerchantController,
  getSingleCustomerController,
  blockCustomerController,
  editCustomerDetailsController,
  getAllRatingsAndReviewsByAgentController,
  addMoneyToWalletController,
  deductMoneyFromWalletCOntroller,
  getCustomersOfMerchant,
  addCustomerFromCSVController,
  downloadCustomerSampleCSVController,
  downloadCustomerCSVController,
  fetchAllCustomersByAdminController,
  fetchCustomersOfMerchantController,
};
