/* eslint-disable prettier/prettier */
const { ObjectID } = require('mongodb');
const { Movie, WatchLists, User } = require('./../models');
const HttpError = require('../exceptions/exceptions');
const { me } = require('./../services/user.service');
const { getWatchList } = require('./../services/user.service');

const index = async queryParamObject => {
  // eslint-disable-next-line prefer-const
  let { limit, offset, ...rest } = queryParamObject;
  limit = Number(limit) || 5;
  offset = Number(offset) || 0;
  const query = queryBuilder(rest);

  const data = await Movie.find(query)
    .limit(limit)
    .skip(offset)
    .exec();
  const count = await Movie.find(query).count();

  return {
    data,
    count,
  };
};

const queryOptions = {
  regex: value => ({ $regex: new RegExp(`.*^${value.toLowerCase()}.*`, 'i') }),
  in: value => ({ $in: [value] }),
};

const fieldOptionMap = {
  title: {
    query: queryOptions.regex,
  },
  genres: {
    query: queryOptions.in,
  },
};

const fieldOptionMapper = (field, value) => fieldOptionMap[field].query(value);

const queryBuilder = queryParamObject => {
  const query = queryParamObject;
  delete query.limit;
  delete query.offset;

  return Object.keys(queryParamObject).reduce(
    (acc, key) => ({ ...acc, [key]: fieldOptionMapper(key, query[key]) }),
    {},
  );
};

const show = async id => {
  if (!ObjectID.isValid(id)) {
    throw new HttpError(400, 'Mallformed id!');
  }
  try {
    const movie = await Movie.findByIdAndUpdate(
      id,
      { $inc: { visits: 1 } },
      { upsert: true, new: true },
    ).populate('genres');
    if (!movie) {
      throw new HttpError(400, 'No movie with that id');
    }
    return movie;
  } catch (err) {
    throw err;
  }
};

const store = ({ title, description, imageUrl, genres }) => {
  if (!title || !description) {
    throw new HttpError(400, 'Title or description missing');
  }

  const movie = new Movie({
    title,
    description,
    imageUrl,
    genres,
  });

  return movie.save().then(newMovie => newMovie.populate('genres').execPopulate());
};

const update = async (id, { title, description, imageUrl, genres }) => {
  if (!title || !description) {
    throw new HttpError(400, 'Title or description missing');
  }

  const newMovie = {
    title,
    description,
    imageUrl,
    genres,
  };

  const updatedMovie = await Movie.findByIdAndUpdate(id, newMovie, {
    upsert: true,
    new: true,
  }).populate('genres');
  return updatedMovie;
};

const destroy = async id => {
  try {
    const deleteResult = await Movie.find({ _id: id })
      .remove()
      .exec();
    if (!deleteResult) {
      throw new HttpError(400, 'No movie with that id');
    }
  } catch (err) {
    throw err;
  }
};

const addToWatchList = async (movieId, token) => {
  if (!ObjectID.isValid(movieId)) {
    throw new HttpError(400, 'Mallformed id!');
  }

  try {
    const newWatchListItem = new WatchLists({
      user: me(token)._id,
      movie: movieId,
    });

    await newWatchListItem.save();
    return await getWatchList(token);
  } catch (err) {
    throw err;
  }
};

const removeFromWatchList = async (movieId, token) => {
  if (!ObjectID.isValid(movieId)) {
    throw new HttpError(400, 'Mallformed id!');
  }

  try {
    const deleteResult = await WatchLists.find({ movie: movieId, user: me(token)._id })
      .remove()
      .exec();
    if (!deleteResult) {
      throw new HttpError(400, 'No such watch list item!');
    }
    return await getWatchList(token);
  } catch (err) {
    throw err;
  }
};

const getTopRated = async () =>
  Movie.find()
    .sort({ likes: -1 })
    .limit(10)
    .exec();

const getRelated = async (movieId, genres) => {
  const movies = await Movie.find().exec();
  return movies.filter(
    movie =>
      movie.genres.some(genre => genres.includes(`${genre}`)) && `${movie._id}` !== `${movieId}`,
  );
};

const react = async (movieId, userId, reactionType) => {
  let operation;
  let updatedMovie;

  const user = await User.findById(userId);
  const movie = await Movie.findById(movieId);

  if (reactionType === 'LIKE') {
    if (user.liked.includes(movieId)) {
      await User.findOneAndUpdate({ _id: userId }, { $pull: { liked: movieId } });
      operation = 'removed';
    } else {
      await User.findOneAndUpdate({ _id: userId }, {
        $push: { liked: movieId },
        $pull: { disliked: user.disliked.includes(movieId) ? movieId : null },
      });
      operation = 'added';
    }

    updatedMovie = await Movie.findOneAndUpdate({ _id: movieId }, { $inc: {
      likes: operation === 'added' ? 1 : -1,
      dislikes: operation === 'added' && movie.dislikes !== 0 ? -1 : 0,
    } }, { new: true });
  } else if (reactionType === 'DISLIKE') {
    if (user.disliked.includes(movieId)) {
      await User.findOneAndUpdate({ _id: userId }, { $pull: { disliked: movieId } });
      operation = 'removed';
    } else {
      await User.findOneAndUpdate({ _id: userId }, {
        $push: { disliked: movieId },
        $pull: { liked: user.liked.includes(movieId) ? movieId : null },
      });
      operation = 'added';
    }

    updatedMovie = await Movie.findOneAndUpdate({ _id: movieId }, { $inc: {
      dislikes: operation === 'added' ? 1 : -1,
      likes: operation === 'added' && movie.likes !== 0 ? -1 : 0,
    } }, { new: true });
  } else {
    throw new HttpError(400, "Reaction doesn't exist");
  }

  return updatedMovie;
};

module.exports = {
  index,
  show,
  store,
  update,
  destroy,
  addToWatchList,
  removeFromWatchList,
  getTopRated,
  getRelated,
  react,
};
